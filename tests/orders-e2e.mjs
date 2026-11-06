// End-to-end check of advance orders against the emulators:
//   npm run test:orders
// Runs placeOrder / updateOrder / the status trigger / trackOrder for real,
// and the till's own send-out batch through the client SDK and the rules.
// SMS can't go out here (no SMSlenz key), which the functions treat as a
// failed text, never as a failed order.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp as clientApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  Timestamp,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  increment,
  serverTimestamp,
  setLogLevel,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp: adminApp } = require("firebase-admin/app");
const { getFirestore: adminFirestore } = require("firebase-admin/firestore");
const { getAuth: adminAuth } = require("firebase-admin/auth");

const PROJECT = process.env.GCLOUD_PROJECT || "demo-vsp-e2e";
// emulators:exec exports where each emulator listens.
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const [FS_HOST, FS_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const FN_BASE = `http://${FN_HOST}/${PROJECT}/us-central1`;
setLogLevel("silent");

adminApp({ projectId: PROJECT });
const adb = adminFirestore();

const app = clientApp({ apiKey: "demo", projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` });
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, FS_HOST, Number(FS_PORT));
const fns = getFunctions(app);
connectFunctionsEmulator(fns, FN_HOST.split(":")[0], Number(FN_HOST.split(":")[1]));
const placeOrder = httpsCallable(fns, "placeOrder");
const updateOrder = httpsCallable(fns, "updateOrder");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}
async function as(email) {
  await signOut(auth).catch(() => {});
  return (await signInWithEmailAndPassword(auth, email, "secret123")).user.uid;
}
async function rejects(promise, code) {
  try {
    await promise;
  } catch (err) {
    if (code) assert.match(String(err.code), new RegExp(code));
    return;
  }
  assert.fail(`expected ${code ?? "an error"}`);
}
function colomboKey(days = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(Date.now() + days * 864e5));
}

let step = 0;
const ok = (msg) => console.log(`  ✔ ${++step}. ${msg}`);

// ── Seed ────────────────────────────────────────────────────────────────
for (const [uid, role] of [["admin", "admin"], ["cash1", "cashier"]]) {
  await adminAuth().createUser({ uid, email: `${uid}@vsp.test`, password: "secret123" }).catch(() => {});
  await adb.doc(`users/${uid}`).set({ name: uid === "admin" ? "Owner" : "Cashier One", role, active: true });
}
await adb.doc("products/broiler").set({ name: "Broiler whole", price: 1200, costPrice: 900, unit: "kg", active: true, categoryId: "chk" });
await adb.doc("products/eggs").set({ name: "Eggs", price: 50, costPrice: 40, unit: "pcs", active: true, categoryId: "egg" });
await adb.doc("customers/kumar").set({
  name: "Kumar Stores", type: "shop", mobileNumber: "0771234567", remainingCredit: 0, openingBalance: 0, active: true, createdAt: 1, updatedAt: 1,
});
await adb.doc("settings/store").set({ orderSmsConfirmed: true, orderSmsOut: true });

console.log("advance orders, end to end", { AUTH_HOST, FS_HOST, FN_HOST });

// ── Place ───────────────────────────────────────────────────────────────
await as("cash1@vsp.test");
await rejects(placeOrder({ customerId: "kumar", deliveryDate: colomboKey(-1), lines: [{ productId: "broiler", qty: 5 }] }), "invalid-argument");
await rejects(placeOrder({ customerId: "kumar", deliveryDate: colomboKey(2), lines: [] }), "invalid-argument");
await rejects(placeOrder({ customerId: "../users/admin", deliveryDate: colomboKey(2), lines: [{ productId: "broiler", qty: 5 }] }), "invalid-argument");
ok("bad dates, empty orders and odd ids are refused");

const placed = (
  await placeOrder({
    customerId: "kumar",
    deliveryDate: colomboKey(2),
    // A price from the browser is ignored when placing.
    lines: [{ productId: "broiler", qty: 25, price: 1 }, { productId: "eggs", qty: 60 }],
    deliveryCharge: 500,
    notes: "Cut into 8",
  })
).data;
assert.equal(placed.orderNo, 1);
assert.equal(placed.sms, "failed"); // no SMSlenz key in the emulator
const orderId = placed.orderId;
let order = (await getDoc(doc(db, "orders", orderId))).data();
assert.equal(order.status, "confirmed");
assert.equal(order.lines[0].price, 1200, "server price, not the browser's");
assert.equal(order.trackToken.length, 22);
ok(`placed OR-0001 at server prices; SMS attempt reported as "${placed.sms}"`);

const second = (await placeOrder({ customerId: "kumar", deliveryDate: colomboKey(3), lines: [{ productId: "eggs", qty: 30 }] })).data;
assert.equal(second.orderNo, 2);
ok("numbers run on: OR-0002");

// ── Track endpoint ──────────────────────────────────────────────────────
const track = async (k) => fetch(`${FN_BASE}/trackOrder?k=${encodeURIComponent(k)}`);
let r = await track(order.trackToken);
assert.equal(r.status, 200);
let t = await r.json();
assert.equal(t.order, "OR-0001");
assert.equal(t.status, "confirmed");
const body = JSON.stringify(t);
for (const secret of ["Kumar", "0771234567", "1200", "kumar", orderId]) assert.ok(!body.includes(secret), `track leaks ${secret}`);
ok("track endpoint: order, status, items — no name, mobile, price or ids");
assert.equal((await track("short")).status, 404);
assert.equal((await track("A".repeat(22))).status, 404);
assert.equal((await track(`${order.trackToken}/../x`)).status, 404);
ok("unknown or malformed tokens all get the same 404");

// ── Admin-only changes ──────────────────────────────────────────────────
await rejects(updateOrder({ orderId, action: "cancel" }), "permission-denied");
await rejects(updateOrder({ orderId, action: "edit", changes: { deliveryDate: colomboKey(4) } }), "permission-denied");
ok("a cashier can't change or cancel a confirmed order");

await as("admin@vsp.test");
const edited = await updateOrder({
  orderId,
  action: "edit",
  changes: { deliveryDate: colomboKey(1), lines: [{ productId: "broiler", qty: 30, price: 1150 }, { productId: "eggs", qty: 60 }] },
  note: "Shop called back",
});
assert.equal(edited.data.changed, true);
order = (await getDoc(doc(db, "orders", orderId))).data();
assert.equal(order.deliveryDate, colomboKey(1));
assert.equal(order.lines[0].price, 1150);
assert.equal(order.lines[1].price, 50, "untouched line keeps its booked price");
let logSnap = await adb.collection(`orders/${orderId}/log`).get();
const editEntry = logSnap.docs.map((d) => d.data()).find((e) => e.action === "edited");
assert.ok(editEntry, "edit logged");
assert.deepEqual(editEntry.changes.map((c) => c.field).sort(), ["deliveryDate", "lines"]);
assert.equal(editEntry.byName, "Owner");
assert.equal(editEntry.note, "Shop called back");
ok("admin edit: date + qty + price, logged with before/after, who and why");

t = await (await track(order.trackToken)).json();
assert.equal(t.deliveryDate, colomboKey(1));
ok("track page follows the new date");

// ── Send out (the till's batch, through the rules) ──────────────────────
const cashUid = await as("cash1@vsp.test");
const billId = `${orderId}-1`;
const now = Date.now();
const lines = [
  { productId: "broiler", name: "Broiler whole", qty: 29.75, price: 1250, listPrice: 1200, costPrice: 900, categoryId: "chk" },
  { productId: "eggs", name: "Eggs", qty: 60, price: 50, costPrice: 40, categoryId: "egg" },
  { productId: "delivery", name: "Delivery charge", qty: 1, price: 500, costPrice: 0 },
];
const total = Math.round(lines.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100;
const batch = writeBatch(db);
batch.set(doc(db, "bills", billId), {
  no: order.orderNo, createdAt: Timestamp.fromMillis(now), syncedAt: serverTimestamp(), cashierId: cashUid, lines, total,
  tender: 0, change: 0, status: "paid", synced: true, provisionalNo: false, customerId: "kumar", customerName: "Kumar Stores",
  paymentType: "credit", paid: 0, due: total, discount: 0, advanceUsed: 0, kind: "order", orderId,
});
batch.update(doc(db, "orders", orderId), { status: "out", billId, outAt: now, outBy: cashUid, updatedAt: now, updatedBy: cashUid });
batch.set(doc(db, "customers", "kumar"), { remainingCredit: increment(total), updatedAt: now }, { merge: true });
await batch.commit();
ok(`sent out as bill ${billId}, ${total} on credit`);

const outLog = await waitFor("send-out log", async () => (await adb.doc(`orders/${orderId}/log/out-1`).get()).data());
const fields = outLog.changes.map((c) => c.field);
assert.ok(fields.includes("price:Broiler whole"), "price change logged");
assert.ok(fields.includes("qty:Broiler whole"), "weighed qty logged");
assert.ok(!fields.includes("deliveryCharge"), "delivery charge unchanged");
assert.equal(outLog.byName, "Cashier One");
ok(`trigger logged the send-out: ${fields.join(", ")}`);
t = await waitFor("tracking out", async () => {
  const x = await (await track(order.trackToken)).json();
  return x.status === "out" ? x : null;
});
ok("track page shows Out for delivery");
assert.equal((await adb.doc("customers/kumar").get()).data().remainingCredit, total);
ok("customer balance went up by the bill total");

// ── Delivered ───────────────────────────────────────────────────────────
await rejects(updateDoc(doc(db, "orders", orderId), { status: "confirmed", updatedAt: Date.now(), updatedBy: cashUid }));
await updateDoc(doc(db, "orders", orderId), { status: "delivered", deliveredAt: Date.now(), deliveredBy: cashUid, updatedAt: Date.now(), updatedBy: cashUid });
await waitFor("delivered log", async () => (await adb.doc(`orders/${orderId}/log/delivered-1`).get()).exists);
const tr = (await adb.doc(`orderTracking/${order.trackToken}`).get()).data();
assert.equal(tr.status, "delivered");
assert.ok(tr.expireAt.toMillis() > Date.now() + 13 * 864e5, "link kept ~14 days");
ok("delivered: logged, tracking updated, link set to expire in 14 days");

// ── Reopen needs the bill voided first ──────────────────────────────────
await as("admin@vsp.test");
await rejects(updateOrder({ orderId, action: "reopen" }), "failed-precondition");
await updateDoc(doc(db, "bills", billId), { status: "void", due: 0 });
await updateOrder({ orderId, action: "reopen", note: "Wrong weights" });
order = (await getDoc(doc(db, "orders", orderId))).data();
assert.equal(order.status, "confirmed");
assert.equal(order.sendSeq, 2);
assert.equal(order.billId, null);
ok("reopen refused while the bill stands; after a void it reopens with sendSeq 2");

// ── Cancel ──────────────────────────────────────────────────────────────
await updateOrder({ orderId: second.orderId, action: "cancel", note: "Shop closed" });
const cancelled = (await getDoc(doc(db, "orders", second.orderId))).data();
assert.equal(cancelled.status, "cancelled");
await rejects(updateOrder({ orderId: second.orderId, action: "edit", changes: { deliveryDate: colomboKey(5) } }), "failed-precondition");
ok("cancelled, and a cancelled order can't be edited");

console.log(`\nall ${step} checks passed`);
process.exit(0);
