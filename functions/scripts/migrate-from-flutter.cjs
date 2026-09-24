// One-off migration: pulls customers + stock from the old Flutter app's
// Firestore (default database, bake_shop_live/vvt_shop/*) into this app's
// named database (bake-shop-uat-v2), and creates the first admin user.
//
// Usage:
//   node functions/scripts/migrate-from-flutter.cjs --dry-run
//   node functions/scripts/migrate-from-flutter.cjs --write
//
// Run from the bake-shop-vvt directory so relative paths resolve.

const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  "../../../bake-shop-9f4f0-firebase-adminsdk-fbsvc-f6754fdb01.json",
);
const TARGET_DATABASE_ID = "bake-shop-live-v2";
const OLD_ROOT = ["bake_shop_live", "vvt_shop"]; // collection/doc path prefix in the old default database

const NEW_CATEGORIES = new Set(["Bakery", "Drinks", "Grocery", "Snacks", "Other"]);

// Already provisioned for this migration — added here only for reference.
// A future admin should be created from Settings → Users in the app instead
// of re-running this script.
const ADMINS = [];

const WRITE = process.argv.includes("--write");

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value;
  return 0;
}

function toDateString(value) {
  const ms = toMillis(value);
  if (!ms) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function mapCategory(oldCategory) {
  if (NEW_CATEGORIES.has(oldCategory)) return oldCategory;
  if (oldCategory === "Bakery") return "Bakery"; // already covered, kept for clarity
  return "Other";
}

function migrateCustomer(doc) {
  const d = doc.data();
  const name = (d.name || "").trim();
  if (!name) return { skip: true, reason: "no name", id: doc.id };

  const due = Math.max(0, Number(d.remainingCredit) || 0);
  const createdAt = toMillis(d.createdAt) || Date.now();

  return {
    id: doc.id,
    data: {
      name,
      type: d.type === "shop" ? "shop" : "person",
      mobileNumber: d.mobileNumber || "",
      remainingCredit: due,
      // Debt carried in from the Flutter app, with no bill behind it here —
      // the app already has a designed slot for exactly this (see
      // src/lib/firestore/customers.ts and the Customers page banner).
      openingBalance: due,
      active: true,
      createdAt,
      updatedAt: Date.now(),
    },
  };
}

function migrateStock(doc) {
  const d = doc.data();
  const name = (d.name || "").trim();
  if (!name) return { skip: true, reason: "no name", id: doc.id };

  const isBakery = d.category === "Bakery";
  const price = Number(d.unitPrice) || 0;

  return {
    id: doc.id,
    data: {
      name,
      price,
      lastPrice: price,
      costPrice: Number(d.costPrice) || 0,
      unit: d.unit || "pieces",
      category: mapCategory(d.category),
      isBakery,
      barcode: isBakery ? null : (d.code || null),
      expiryDate: toDateString(d.expiryDate),
      minLevel: null,
      maxLevel: null,
      active: true,
      onShelf: Number(d.quantity) || 0,
      imageUrl: d.imageUrl || null,
    },
  };
}

async function ensureAdmin(app, targetDb, { email, password, name }) {
  const auth = getAuth(app);
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`Admin auth user already exists: ${email} (${user.uid})`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    if (!WRITE) {
      console.log(`[dry-run] Would create auth user ${email}`);
      return;
    }
    user = await auth.createUser({ email, password, displayName: name });
    console.log(`Created admin auth user: ${email} (${user.uid})`);
  }

  if (!WRITE) {
    console.log(`[dry-run] Would set role:admin claim + users/${user?.uid ?? "<new>"} doc for ${email}`);
    return;
  }

  await auth.setCustomUserClaims(user.uid, { role: "admin" });
  await targetDb.doc(`users/${user.uid}`).set(
    {
      name,
      email,
      role: "admin",
      active: true,
      createdAt: Date.now(),
      createdBy: "migration-script",
    },
    { merge: true },
  );
  console.log(`Set users/${user.uid} = admin (${email})`);
}

async function main() {
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  const app = initializeApp({ credential: cert(serviceAccount) });

  // The Flutter app's data lives in the (default) database, nested under a
  // fixed collection/doc pair — see AppsConstant.database / AppsConstant.doc.
  const sourceDb = getFirestore(app);
  const targetDb = getFirestore(app, TARGET_DATABASE_ID);

  const oldRoot = sourceDb.collection(OLD_ROOT[0]).doc(OLD_ROOT[1]);

  const [customersSnap, stocksSnap] = await Promise.all([
    oldRoot.collection("customers").get(),
    oldRoot.collection("stocks").get(),
  ]);

  console.log(`Found ${customersSnap.size} customers, ${stocksSnap.size} stock items in the old app.`);
  console.log(WRITE ? "Mode: WRITE (changes will be committed)" : "Mode: DRY RUN (no writes)");
  console.log("");

  let customersOk = 0;
  let customersSkipped = 0;
  let dueCount = 0;
  let dueTotal = 0;

  for (const doc of customersSnap.docs) {
    const result = migrateCustomer(doc);
    if (result.skip) {
      customersSkipped++;
      console.log(`  skip customer ${result.id}: ${result.reason}`);
      continue;
    }
    customersOk++;
    if (result.data.openingBalance > 0) {
      dueCount++;
      dueTotal += result.data.openingBalance;
    }
    if (WRITE) {
      await targetDb.collection("customers").doc(result.id).set(result.data, { merge: true });
    }
  }

  let stocksOk = 0;
  let stocksSkipped = 0;

  for (const doc of stocksSnap.docs) {
    const result = migrateStock(doc);
    if (result.skip) {
      stocksSkipped++;
      console.log(`  skip stock ${result.id}: ${result.reason}`);
      continue;
    }
    stocksOk++;
    if (WRITE) {
      await targetDb.collection("products").doc(result.id).set(result.data, { merge: true });
    }
  }

  console.log("");
  console.log(`Customers: ${customersOk} migrated, ${customersSkipped} skipped.`);
  console.log(`  ${dueCount} customer(s) carry a due balance totalling ${dueTotal.toFixed(2)} (set as openingBalance).`);
  console.log(`Stock items: ${stocksOk} migrated, ${stocksSkipped} skipped.`);
  console.log("");

  for (const admin of ADMINS) {
    await ensureAdmin(app, targetDb, admin);
  }

  console.log("");
  console.log(WRITE ? "Done." : "Dry run complete — re-run with --write to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
