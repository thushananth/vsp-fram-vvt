#!/usr/bin/env node
/**
 * One-off: copy customers and stock from the Flutter app into this one.
 *
 * Both apps live in the same Firebase project but different Firestore
 * databases — the Flutter app in `(default)`, this app in `bake-shop-uat-v2` —
 * so one Admin SDK credential reads both.
 *
 *   node functions/scripts/migrate-from-flutter.js                # dry run
 *   node functions/scripts/migrate-from-flutter.js --write        # actually write
 *   node functions/scripts/migrate-from-flutter.js --only=customers
 *   node functions/scripts/migrate-from-flutter.js --bakery-categories=Bakery,Bread
 *
 * Source document IDs are preserved, and every write is a merge, so a second
 * run corrects rather than duplicates.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * key, or `gcloud auth application-default login`.
 *
 * See docs/customersAndCredit.md for the field mapping and why
 * `openingBalance` exists.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT_ID = "bake-shop-9f4f0";
const TARGET_DATABASE_ID = "bake-shop-uat-v2";

// The Flutter data's walk-in placeholder customer — this app uses a null
// customerId on the bill instead, so the placeholder is not carried over.
const WALKIN_MOBILE = "0000000000";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const only = (args.find((a) => a.startsWith("--only=")) || "").split("=")[1];
const bakeryCategories = ((args.find((a) => a.startsWith("--bakery-categories=")) || "")
  .split("=")[1] || "Bakery")
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const source = getFirestore(); // (default) — the Flutter app
const target = getFirestore(TARGET_DATABASE_ID); // this app

function millis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return null;
}

function isoDate(value) {
  const ms = millis(value);
  return ms ? new Date(ms).toISOString().slice(0, 10) : null;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Write in batches of 400 — the Firestore limit is 500 operations. */
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = target.batch();
    for (const w of writes.slice(i, i + 400)) {
      batch.set(w.ref, w.data, { merge: true });
    }
    await batch.commit();
  }
}

async function migrateCustomers() {
  const snap = await source.collection("customers").get();
  const writes = [];
  let skipped = 0;
  let owing = 0;
  let owed = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const mobileNumber = (d.mobileNumber || "").trim();
    if (mobileNumber === WALKIN_MOBILE) {
      skipped++;
      continue;
    }

    const remainingCredit = num(d.remainingCredit);
    if (remainingCredit > 0) {
      owing++;
      owed += remainingCredit;
    }

    writes.push({
      ref: target.collection("customers").doc(doc.id),
      data: {
        name: d.name || "",
        type: d.type === "shop" ? "shop" : "person",
        mobileNumber,
        remainingCredit,
        // Their bills are NOT copied, so the whole balance arrives as an
        // opening balance — otherwise it could never be paid off here.
        openingBalance: remainingCredit,
        active: true,
        createdAt: millis(d.createdAt) || Date.now(),
        updatedAt: Date.now(),
      },
    });
  }

  console.log(`\ncustomers: ${snap.size} read, ${writes.length} to write, ${skipped} skipped (walk-in)`);
  console.log(`  ${owing} arrive owing money, ${owed.toFixed(2)} in total`);

  const top = writes
    .map((w) => w.data)
    .filter((c) => c.remainingCredit > 0)
    .sort((a, b) => b.remainingCredit - a.remainingCredit)
    .slice(0, 10);
  if (top.length) {
    console.log("  largest balances — check these against the Flutter app:");
    for (const c of top) {
      console.log(`    ${c.remainingCredit.toFixed(2).padStart(12)}  ${c.name}`);
    }
  }

  if (WRITE) {
    await commit(writes);
    console.log(`  written.`);
  }
}

async function migrateStock() {
  const snap = await source.collection("stocks").get();
  const writes = [];
  const categories = new Map();

  for (const doc of snap.docs) {
    const d = doc.data();
    const category = d.category || "Other";
    const isBakery = bakeryCategories.includes(String(category).toLowerCase());
    categories.set(category, (categories.get(category) || 0) + 1);

    const price = num(d.unitPrice);
    const barcode = (d.code || "").trim();

    writes.push({
      ref: target.collection("products").doc(doc.id),
      data: {
        name: d.name || "",
        price,
        lastPrice: price,
        costPrice: num(d.costPrice),
        unit: d.unit || "pieces",
        category,
        // No such flag in the Flutter data — derived from the category, which
        // is why --bakery-categories exists. Check the dry-run's breakdown.
        isBakery,
        barcode: isBakery ? null : barcode || null,
        expiryDate: isoDate(d.expiryDate),
        // status is dropped: derived here from onShelf against minLevel.
        onShelf: num(d.quantity),
        minLevel: null,
        maxLevel: null,
        active: true,
      },
    });
  }

  const bakeryCount = writes.filter((w) => w.data.isBakery).length;
  console.log(`\nstocks → products: ${snap.size} read, ${writes.length} to write`);
  console.log(`  ${bakeryCount} bakery, ${writes.length - bakeryCount} barcoded goods`);
  console.log(`  categories seen (bakery match: ${bakeryCategories.join(", ")}):`);
  for (const [category, count] of [...categories].sort((a, b) => b[1] - a[1])) {
    const flag = bakeryCategories.includes(category.toLowerCase()) ? "bakery" : "goods";
    console.log(`    ${String(count).padStart(5)}  ${category}  → ${flag}`);
  }

  const noBarcode = writes.filter((w) => !w.data.isBakery && !w.data.barcode).length;
  if (noBarcode) {
    console.log(`  ${noBarcode} non-bakery items have no barcode — they can only be tapped, not scanned.`);
  }

  if (WRITE) {
    await commit(writes);
    console.log(`  written.`);
  }
}

async function main() {
  console.log(
    WRITE
      ? `WRITING to ${PROJECT_ID}/${TARGET_DATABASE_ID}`
      : `DRY RUN — nothing will be written. Add --write when the numbers look right.`,
  );

  if (!only || only === "customers") await migrateCustomers();
  if (!only || only === "stock") await migrateStock();

  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
