// Firestore rules tests. Run with:  npm run test:rules
// (firebase emulators:exec starts the Firestore emulator for the run.)
//
// Each test replays a write the app really makes — the till's bill batch,
// the bill-number lease, a credit payment, a void, sending an order out —
// so tightening a rule can't quietly stop the shop from billing.

import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  setLogLevel,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";

let env;
setLogLevel("silent");

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-vsp-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await env?.cleanup();
});

const ORDER = {
  orderNo: 43,
  customerId: "c1",
  customerName: "Kumar Stores",
  deliveryDate: "2026-11-18",
  lines: [{ productId: "p1", name: "Broiler", unit: "kg", qty: 25, price: 1200 }],
  deliveryCharge: 500,
  notes: null,
  status: "confirmed",
  sendSeq: 1,
  billId: null,
  trackToken: "AbCdEfGhIjKlMnOpQrStUv",
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/admin"), { name: "Admin", role: "admin", active: true });
    await setDoc(doc(db, "users/cash1"), { name: "Cashier", role: "cashier", active: true });
    await setDoc(doc(db, "users/cash2"), { name: "Other", role: "cashier" });
    await setDoc(doc(db, "users/off"), { name: "Left", role: "cashier", active: false });
    await setDoc(doc(db, "settings/cashierPermissions"), { voidBills: false, editBillPrices: true });
    await setDoc(doc(db, "products/p1"), { name: "Broiler", price: 1200, unit: "kg", active: true });
    await setDoc(doc(db, "customers/c1"), {
      name: "Kumar Stores", type: "shop", mobileNumber: "0771234567",
      remainingCredit: 0, openingBalance: 2000, active: true, createdAt: 1, updatedAt: 1,
    });
    // A customer brought over from the Flutter app, missing fields.
    await setDoc(doc(db, "customers/legacy"), { name: "", remainingCredit: 100 });
    await setDoc(doc(db, "counters/bills"), { seq: 100 });
    await setDoc(doc(db, "orders/o1"), ORDER);
    await setDoc(doc(db, "orders/o1/log/placed"), { action: "placed" });
    await setDoc(doc(db, "orderTracking/AbCdEfGhIjKlMnOpQrStUv"), { status: "confirmed" });
    await setDoc(doc(db, "bills/old"), {
      no: 7, createdAt: Timestamp.fromMillis(1), cashierId: "cash1", lines: [{}], total: 100,
      status: "paid", paymentType: "cash", paid: 100, due: 0, customerId: null,
    });
    await setDoc(doc(db, "bills/owing"), {
      no: 8, createdAt: Timestamp.fromMillis(1), cashierId: "cash1", lines: [{}], total: 500,
      status: "paid", paymentType: "credit", paid: 0, due: 500, customerId: "c1",
    });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

/** Exactly what commitBill (src/lib/firestore/bills.ts) writes. */
function billDoc(overrides = {}) {
  return {
    no: 101,
    createdAt: Timestamp.fromMillis(Date.now()),
    syncedAt: serverTimestamp(),
    cashierId: "cash1",
    lines: [{ productId: "p1", name: "Broiler", qty: 1.25, price: 1200, costPrice: 900 }],
    total: 1500,
    tender: 2000,
    change: 500,
    status: "paid",
    synced: true,
    provisionalNo: false,
    customerId: null,
    customerName: null,
    paymentType: "cash",
    paid: 1500,
    due: 0,
    discount: 0,
    advanceUsed: 0,
    ...overrides,
  };
}

/** The send-out batch: OR- bill, order → out, balance increment. */
function sendOutBatch(db, uid, { billId = "o1-1", bill = {}, order = {} } = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, "bills", billId), billDoc({
    no: 43, cashierId: uid, customerId: "c1", customerName: "Kumar Stores",
    paymentType: "credit", paid: 0, tender: 0, change: 0, total: 30500, due: 30500,
    kind: "order", orderId: "o1", ...bill,
  }));
  batch.update(doc(db, "orders/o1"), {
    status: "out", billId, outAt: Date.now(), outBy: uid, updatedAt: Date.now(), updatedBy: uid, ...order,
  });
  batch.set(doc(db, "customers/c1"), { remainingCredit: increment(30500), updatedAt: Date.now() }, { merge: true });
  return batch.commit();
}

describe("who counts as staff", () => {
  test("a signed-in stranger with no profile reads nothing", async () => {
    await assertFails(getDoc(doc(as("stranger"), "products/p1")));
    await assertFails(getDoc(doc(as("stranger"), "customers/c1")));
    await assertFails(getDoc(doc(as("stranger"), "bills/old")));
  });
  test("a stranger may still read their own (missing) profile, so AuthGate can tell", async () => {
    await assertSucceeds(getDoc(doc(as("stranger"), "users/stranger")));
    await assertFails(getDoc(doc(as("stranger"), "users/admin")));
  });
  test("a switched-off cashier reads nothing", async () => {
    await assertFails(getDoc(doc(as("off"), "products/p1")));
    await assertFails(setDoc(doc(as("off"), "bills/x"), billDoc({ cashierId: "off" })));
  });
  test("signed out reads nothing", async () => {
    await assertFails(getDoc(doc(anon(), "products/p1")));
  });
  test("an active cashier reads, including one whose profile has no active field", async () => {
    await assertSucceeds(getDoc(doc(as("cash1"), "products/p1")));
    await assertSucceeds(getDoc(doc(as("cash2"), "customers/c1")));
  });
});

describe("till bills", () => {
  test("cash sale as commitBill writes it", async () => {
    await assertSucceeds(setDoc(doc(as("cash1"), "bills/b1"), billDoc()));
  });
  test("credit sale batch with the balance increment", async () => {
    const db = as("cash1");
    const batch = writeBatch(db);
    batch.set(doc(db, "bills/b2"), billDoc({ customerId: "c1", customerName: "Kumar", paymentType: "credit", paid: 0, due: 1500 }));
    batch.set(doc(db, "customers/c1"), { remainingCredit: increment(1500), advance: increment(-0), updatedAt: Date.now() }, { merge: true });
    await assertSucceeds(batch.commit());
  });
  test("balance increment on a migrated customer with missing fields", async () => {
    const db = as("cash1");
    const batch = writeBatch(db);
    batch.set(doc(db, "bills/b3"), billDoc({ customerId: "legacy", paymentType: "credit", paid: 0, due: 1500 }));
    batch.set(doc(db, "customers/legacy"), { remainingCredit: increment(1500), updatedAt: Date.now() }, { merge: true });
    await assertSucceeds(batch.commit());
  });
  test("a cashier can't write a bill in someone else's name; an admin re-sending a held one can", async () => {
    await assertFails(setDoc(doc(as("cash1"), "bills/b4"), billDoc({ cashierId: "cash2" })));
    await assertSucceeds(setDoc(doc(as("admin"), "bills/b4"), billDoc({ cashierId: "cash2" })));
  });
  test("malformed bills are refused", async () => {
    const db = as("cash1");
    await assertFails(setDoc(doc(db, "bills/m1"), billDoc({ lines: [] })));
    await assertFails(setDoc(doc(db, "bills/m2"), billDoc({ due: -5 })));
    await assertFails(setDoc(doc(db, "bills/m3"), billDoc({ status: "void" })));
    await assertFails(setDoc(doc(db, "bills/m4"), billDoc({ total: "1500" })));
    const { paid, ...noPaid } = billDoc();
    void paid;
    await assertFails(setDoc(doc(db, "bills/m5"), noPaid));
  });
  test("settling credit (payCredit) moves paid/due only", async () => {
    await assertSucceeds(setDoc(doc(as("cash1"), "bills/owing"), { paid: 500, due: 0 }, { merge: true }));
    await assertFails(setDoc(doc(as("cash1"), "bills/owing"), { paid: 500, due: 0, total: 1 }, { merge: true }));
  });
  test("voiding needs the permission", async () => {
    await assertFails(setDoc(doc(as("cash1"), "bills/old"), { status: "void", due: 0 }, { merge: true }));
    await assertSucceeds(setDoc(doc(as("admin"), "bills/old"), { status: "void", due: 0 }, { merge: true }));
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "settings/cashierPermissions"), { voidBills: true }, { merge: true }),
    );
    await assertSucceeds(setDoc(doc(as("cash1"), "bills/owing"), { status: "void", due: 0 }, { merge: true }));
  });
  test("linking a walk-in's paid bill to a new customer", async () => {
    await assertSucceeds(updateDoc(doc(as("cash1"), "bills/old"), { customerId: "c1", customerName: "Kumar" }));
  });
  test("no one deletes a bill", async () => {
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(as("admin"), "bills/old")));
  });
});

describe("customers and payments", () => {
  test("a new customer as startCreateCustomer writes it", async () => {
    await assertSucceeds(setDoc(doc(as("cash1"), "customers/n1"), {
      name: "Ravi", type: "person", mobileNumber: "0771112223", autoNamed: false,
      remainingCredit: 0, openingBalance: 0, active: true, createdAt: 1, updatedAt: 1,
    }));
  });
  test("a new customer can't start with a balance or bad type", async () => {
    const base = { name: "X", type: "person", mobileNumber: "077", remainingCredit: 0, openingBalance: 0, active: true };
    await assertFails(setDoc(doc(as("cash1"), "customers/n2"), { ...base, remainingCredit: 500 }));
    await assertFails(setDoc(doc(as("cash1"), "customers/n3"), { ...base, advance: 500 }));
    await assertFails(setDoc(doc(as("cash1"), "customers/n4"), { ...base, type: "vip" }));
  });
  test("opening balance only goes down, unless an admin", async () => {
    await assertSucceeds(setDoc(doc(as("cash1"), "customers/c1"), { openingBalance: 1500 }, { merge: true }));
    await assertFails(setDoc(doc(as("cash1"), "customers/c1"), { openingBalance: 9000 }, { merge: true }));
    await assertSucceeds(setDoc(doc(as("admin"), "customers/c1"), { openingBalance: 9000 }, { merge: true }));
  });
  test("editing name / type / mobile", async () => {
    await assertSucceeds(setDoc(doc(as("cash1"), "customers/c1"), { name: "Kumar Traders", updatedAt: 2 }, { merge: true }));
    await assertFails(setDoc(doc(as("cash1"), "customers/c1"), { name: "" }, { merge: true }));
  });
  test("payCredit's transaction: receipt in your own name", async () => {
    const db = as("cash1");
    await assertSucceeds(runTransaction(db, async (tx) => {
      await tx.get(doc(db, "customers/c1"));
      tx.set(doc(db, "bills/owing"), { paid: 500, due: 0 }, { merge: true });
      tx.set(doc(db, "customers/c1"), { remainingCredit: 0, updatedAt: Date.now() }, { merge: true });
      tx.set(doc(db, "creditPayments/p1"), {
        customerId: "c1", customerName: "Kumar", amount: 500, method: "cash",
        allocations: [{ billId: "owing", billNo: 8, amount: 500 }], advance: 0,
        receivedBy: "cash1", createdAt: Date.now(), note: null,
      });
    }));
  });
  test("a receipt can't be written in another cashier's name, or as imported", async () => {
    const p = { customerId: "c1", customerName: "K", amount: 500, method: "cash", allocations: [], advance: 0, createdAt: 1, note: null };
    await assertFails(setDoc(doc(as("cash1"), "creditPayments/x1"), { ...p, receivedBy: "cash2" }));
    await assertFails(setDoc(doc(as("cash1"), "creditPayments/x2"), { ...p, receivedBy: "cash1", imported: true }));
  });
});

describe("bill-number lease", () => {
  test("reserveBlock's transaction moves the counter forward", async () => {
    const db = as("cash1");
    await assertSucceeds(runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, "counters/bills"));
      tx.set(doc(db, "counters/bills"), { seq: (snap.data()?.seq ?? 0) + 500 }, { merge: true });
    }));
  });
  test("the counter can't be rewound or given other fields", async () => {
    await assertFails(setDoc(doc(as("cash1"), "counters/bills"), { seq: 5 }, { merge: true }));
    await assertFails(setDoc(doc(as("cash1"), "counters/bills"), { seq: 900, x: 1 }, { merge: true }));
  });
  test("the order counter belongs to functions alone", async () => {
    await assertFails(setDoc(doc(as("admin"), "counters/orders"), { seq: 1 }));
    await assertFails(getDoc(doc(as("admin"), "counters/orders")));
  });
});

describe("advance orders", () => {
  test("no client creates, edits or deletes an order directly", async () => {
    await assertFails(setDoc(doc(as("admin"), "orders/new"), { ...ORDER }));
    await assertFails(updateDoc(doc(as("admin"), "orders/o1"), { deliveryDate: "2026-12-01" }));
    await assertFails(updateDoc(doc(as("admin"), "orders/o1"), { status: "cancelled" }));
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(as("admin"), "orders/o1")));
  });
  test("staff read orders; strangers don't", async () => {
    await assertSucceeds(getDoc(doc(as("cash1"), "orders/o1")));
    await assertFails(getDoc(doc(as("stranger"), "orders/o1")));
  });
  test("the change log: admin reads, nobody writes", async () => {
    await assertSucceeds(getDoc(doc(as("admin"), "orders/o1/log/placed")));
    await assertFails(getDoc(doc(as("cash1"), "orders/o1/log/placed")));
    await assertFails(setDoc(doc(as("admin"), "orders/o1/log/fake"), { action: "edited" }));
  });
  test("tracking copies are invisible to every client", async () => {
    await assertFails(getDoc(doc(as("admin"), "orderTracking/AbCdEfGhIjKlMnOpQrStUv")));
    await assertFails(getDoc(doc(anon(), "orderTracking/AbCdEfGhIjKlMnOpQrStUv")));
  });
  test("send out: OR- bill and order move together", async () => {
    await assertSucceeds(sendOutBatch(as("cash1"), "cash1"));
  });
  test("send out by an admin", async () => {
    await assertSucceeds(sendOutBatch(as("admin"), "admin"));
  });
  test("an OR- bill on its own is refused", async () => {
    await assertFails(setDoc(doc(as("cash1"), "bills/o1-1"), billDoc({
      no: 43, customerId: "c1", paymentType: "credit", paid: 0, due: 30500, kind: "order", orderId: "o1",
    })));
  });
  test("the order can't go out without its bill", async () => {
    await assertFails(updateDoc(doc(as("cash1"), "orders/o1"), {
      status: "out", billId: "o1-1", outAt: 1, outBy: "cash1", updatedAt: 1, updatedBy: "cash1",
    }));
  });
  test("wrong bill id, number or customer is refused", async () => {
    await assertFails(sendOutBatch(as("cash1"), "cash1", { billId: "o1-2" }));
    await assertFails(sendOutBatch(as("cash1"), "cash1", { bill: { no: 999 } }));
    await assertFails(sendOutBatch(as("cash1"), "cash1", { bill: { customerId: "legacy" } }));
    await assertFails(sendOutBatch(as("cash1"), "cash1", { bill: { paymentType: "cash" } }));
  });
  test("can't send out in someone else's name or change the order's lines on the way", async () => {
    await assertFails(sendOutBatch(as("cash1"), "cash2"));
    await assertFails(sendOutBatch(as("cash1"), "cash1", { order: { deliveryCharge: 0 } }));
  });
  test("a till bill can't pretend to belong to an order", async () => {
    await assertFails(setDoc(doc(as("cash1"), "bills/b9"), billDoc({ orderId: "o1" })));
  });
  test("delivered after out; never backwards", async () => {
    await assertSucceeds(sendOutBatch(as("cash1"), "cash1"));
    const now = Date.now();
    await assertFails(updateDoc(doc(as("cash1"), "orders/o1"), { status: "confirmed", updatedAt: now, updatedBy: "cash1" }));
    await assertSucceeds(updateDoc(doc(as("cash1"), "orders/o1"), {
      status: "delivered", deliveredAt: now, deliveredBy: "cash1", updatedAt: now, updatedBy: "cash1",
    }));
    await assertFails(updateDoc(doc(as("cash1"), "orders/o1"), {
      status: "out", outAt: now, outBy: "cash1", updatedAt: now, updatedBy: "cash1",
    }));
  });
  test("can't jump straight from confirmed to delivered", async () => {
    const now = Date.now();
    await assertFails(updateDoc(doc(as("cash1"), "orders/o1"), {
      status: "delivered", deliveredAt: now, deliveredBy: "cash1", updatedAt: now, updatedBy: "cash1",
    }));
  });
  test("an OR- bill can't be re-linked to a walk-in customer", async () => {
    await assertSucceeds(sendOutBatch(as("cash1"), "cash1", { bill: { total: 0, due: 0 } }));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "bills/o1-1"), { customerId: null }));
    await assertFails(updateDoc(doc(as("cash1"), "bills/o1-1"), { customerId: "c1", customerName: "K" }));
  });
  test("with manageOrders switched off, a cashier can't touch orders", async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "settings/cashierPermissions"), { manageOrders: false }, { merge: true }),
    );
    await assertFails(getDoc(doc(as("cash1"), "orders/o1")));
    await assertFails(sendOutBatch(as("cash1"), "cash1"));
    await assertSucceeds(sendOutBatch(as("admin"), "admin"));
  });
});

describe("settings and admin-only data", () => {
  test("staff read settings, only admins write them", async () => {
    await assertSucceeds(getDoc(doc(as("cash1"), "settings/store")));
    await assertFails(setDoc(doc(as("cash1"), "settings/store"), { orderSmsConfirmed: false }, { merge: true }));
    await assertSucceeds(setDoc(doc(as("admin"), "settings/store"), { orderSmsConfirmed: false }, { merge: true }));
  });
  test("alert de-duplication markers are server-only", async () => {
    await assertFails(getDoc(doc(as("admin"), "orderDigests/2026-11-18_morning")));
  });
});

describe("product photos (storage.rules)", () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  test("staff upload a product photo", async () => {
    const storage = env.authenticatedContext("cash1").storage();
    await assertSucceeds(uploadBytes(ref(storage, "products/p1/photo.png"), png, { contentType: "image/png" }));
  });
  test("a signed-in stranger or a switched-off cashier can't", async () => {
    for (const uid of ["stranger", "off"]) {
      const storage = env.authenticatedContext(uid).storage();
      await assertFails(uploadBytes(ref(storage, "products/p1/x.png"), png, { contentType: "image/png" }));
    }
  });
  test("only images, nowhere else", async () => {
    const storage = env.authenticatedContext("admin").storage();
    await assertFails(uploadBytes(ref(storage, "products/p1/x.html"), png, { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(storage, "other/x.png"), png, { contentType: "image/png" }));
  });
});
