"use client";

import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Product } from "@/lib/types";

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Update any product's stock, price and expiry — bakery and barcoded goods alike. */
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
