"use client";

import { doc, increment, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Product } from "@/lib/types";
import { localDateKey } from "@/lib/format";

export function todayKey(): string {
  return localDateKey();
}

/**
 * Update any product's stock, price and expiry — farm and barcoded goods alike.
 *
 * `addQty` goes on with increment(), not as a total computed from the value on
 * screen — otherwise a delivery someone else logged while this sheet was open
 * would be overwritten. lastPrice only moves when the price actually changes,
 * so saving a stock intake doesn't erase the real previous price.
 */
export async function updateGoodsStock(params: {
  product: Product;
  addQty: number;
  price: number;
  costPrice: number;
  expiryDate: string | null;
  minLevel: number | null;
  maxLevel: number | null;
}) {
  const { product, addQty, price, costPrice, expiryDate, minLevel, maxLevel } = params;
  await setDoc(
    doc(db, "products", product.id),
    {
      ...(addQty > 0 ? { onShelf: increment(addQty) } : {}),
      price,
      lastPrice: price !== product.price ? product.price : (product.lastPrice ?? product.price),
      costPrice,
      expiryDate,
      minLevel,
      maxLevel,
    },
    { merge: true },
  );
}
