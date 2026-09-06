"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { BakeryDayItem, Product } from "@/lib/types";

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useBakeryDay(date: string): { items: BakeryDayItem[]; loading: boolean } {
  const [items, setItems] = useState<BakeryDayItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(db, "bakeryDays", date, "items");
    return onSnapshot(
      ref,
      (snap) => {
        setItems(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              productId: d.id,
              name: data.name ?? "",
              received: data.received ?? 0,
              sold: data.sold ?? 0,
              returned: data.returned ?? 0,
            } satisfies BakeryDayItem;
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [date]);

  return { items, loading };
}

/**
 * Record the morning bakery intake for one item — writes the day's received
 * count and updates the product's price fields in the same transaction, so
 * a saved popup can never land half-applied on a dropping connection.
 */
export async function recordBakeryIntake(params: {
  date: string;
  product: Product;
  received: number;
  price: number;
  costPrice: number;
  minLevel: number | null;
  maxLevel: number | null;
}) {
  const { date, product, received, price, costPrice, minLevel, maxLevel } = params;
  return runTransaction(db, async (tx) => {
    const dayItemRef = doc(db, "bakeryDays", date, "items", product.id);
    const daySnap = await tx.get(dayItemRef);
    tx.set(
      dayItemRef,
      {
        name: product.name,
        received,
        sold: daySnap.data()?.sold ?? 0,
        returned: daySnap.data()?.returned ?? 0,
      },
      { merge: true },
    );

    tx.set(
      doc(db, "products", product.id),
      { price, lastPrice: product.price, costPrice, minLevel, maxLevel },
      { merge: true },
    );
  });
}

/** Update a barcoded good: qty (as maxLevel-tracked stock), price, expiry. */
export async function updateGoodsStock(params: {
  product: Product;
  qty: number;
  price: number;
  costPrice: number;
  expiryDate: string | null;
  minLevel: number | null;
  maxLevel: number | null;
}) {
  const { product, qty, price, costPrice, expiryDate, minLevel, maxLevel } = params;
  await runTransaction(db, async (tx) => {
    tx.set(
      doc(db, "products", product.id),
      {
        onShelf: qty,
        price,
        lastPrice: product.price,
        costPrice,
        expiryDate,
        minLevel,
        maxLevel,
      },
      { merge: true },
    );
  });
}
