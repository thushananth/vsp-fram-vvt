"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { toBill, toCategory, toCustomer, toOrder, toPayment, toProduct, toStaff, toStoreFacts } from "./convert";
import { TooManyRowsError, type DataSource } from "./types";

/**
 * The assistant's only door to Firestore, and it only reads: this folder may
 * import nothing from firebase/firestore but the read calls below (an ESLint
 * rule enforces it). Reads run as the signed-in admin, so the deployed rules
 * decide what comes back, exactly as on every other screen.
 *
 * Each query has at most one range filter, on a single field, because the
 * shop has no composite indexes. Everything else is filtered in code.
 * `limit(maxDocs + 1)` makes an over-budget read fail instead of costing more.
 */

function check<T>(snap: QuerySnapshot<DocumentData>, maxDocs: number, what: string, map: (id: string, d: DocumentData) => T): T[] {
  if (snap.size > maxDocs) throw new TooManyRowsError(what);
  return snap.docs.map((d) => map(d.id, d.data()));
}

function millis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  return typeof v === "number" ? v : 0;
}

export const firestoreSource: DataSource = {
  async bills(r, maxDocs) {
    // bills.createdAt is a Firestore Timestamp.
    const snap = await getDocs(
      query(
        collection(db, "bills"),
        where("createdAt", ">=", Timestamp.fromMillis(r.startMs)),
        where("createdAt", "<", Timestamp.fromMillis(r.endMs)),
        orderBy("createdAt", "asc"),
        limit(maxDocs + 1),
      ),
    );
    return check(snap, maxDocs, "bills", (id, d) => toBill(id, d, millis(d.createdAt)));
  },

  async billsForCustomer(customerId, maxDocs) {
    const snap = await getDocs(query(collection(db, "bills"), where("customerId", "==", customerId), limit(maxDocs + 1)));
    return check(snap, maxDocs, "this customer's bills", (id, d) => toBill(id, d, millis(d.createdAt)));
  },

  async creditPayments(r, maxDocs) {
    // creditPayments.createdAt is epoch millis, not a Timestamp.
    const snap = await getDocs(
      query(
        collection(db, "creditPayments"),
        where("createdAt", ">=", r.startMs),
        where("createdAt", "<", r.endMs),
        orderBy("createdAt", "asc"),
        limit(maxDocs + 1),
      ),
    );
    return check(snap, maxDocs, "payments", toPayment);
  },

  async paymentsForCustomer(customerId, maxDocs) {
    const snap = await getDocs(
      query(collection(db, "creditPayments"), where("customerId", "==", customerId), limit(maxDocs + 1)),
    );
    return check(snap, maxDocs, "this customer's payments", toPayment);
  },

  async orders(from, to, maxDocs) {
    // orders.deliveryDate is a "yyyy-mm-dd" string.
    const snap = await getDocs(
      query(
        collection(db, "orders"),
        where("deliveryDate", ">=", from),
        where("deliveryDate", "<=", to),
        orderBy("deliveryDate", "asc"),
        limit(maxDocs + 1),
      ),
    );
    return check(snap, maxDocs, "orders", toOrder);
  },

  async customers(maxDocs) {
    const snap = await getDocs(query(collection(db, "customers"), limit(maxDocs + 1)));
    return check(snap, maxDocs, "customers", toCustomer);
  },

  async products(maxDocs) {
    const snap = await getDocs(query(collection(db, "products"), limit(maxDocs + 1)));
    return check(snap, maxDocs, "products", toProduct);
  },

  async categories(maxDocs) {
    const snap = await getDocs(query(collection(db, "categories"), limit(maxDocs + 1)));
    return check(snap, maxDocs, "categories", toCategory);
  },

  async users(maxDocs) {
    const snap = await getDocs(query(collection(db, "users"), limit(maxDocs + 1)));
    return check(snap, maxDocs, "staff", toStaff);
  },

  async storeFacts() {
    const snap = await getDoc(doc(db, "settings", "store"));
    return toStoreFacts(snap.data());
  },
};
