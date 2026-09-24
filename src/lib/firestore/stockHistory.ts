"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * A log of stock going ON the shelf — purchases/intake only. It does not
 * track sales at all; units sold already live in bills, and mixing the two
 * here would make "how much did we buy" and "how much did we sell" the same
 * number to read at a glance when they never are.
 */
export interface StockHistoryEntry {
  id: string;
  productId: string;
  name: string;
  qty: number;
  price: number;
  costPrice: number;
  byUserId: string;
  createdAt: number;
}

export function useStockHistory(): { history: StockHistoryEntry[]; loading: boolean } {
  const [history, setHistory] = useState<StockHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "stockHistory"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setHistory(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              productId: data.productId ?? "",
              name: data.name ?? "",
              qty: data.qty ?? 0,
              price: data.price ?? 0,
              costPrice: data.costPrice ?? 0,
              byUserId: data.byUserId ?? "",
              createdAt: data.createdAt ?? 0,
            } satisfies StockHistoryEntry;
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { history, loading };
}

/** One purchase entry — logged whenever stock is added, never for a sale. */
export async function logStockPurchase(params: {
  productId: string;
  name: string;
  qty: number;
  price: number;
  costPrice: number;
  byUserId: string;
}) {
  const { productId, name, qty, price, costPrice, byUserId } = params;
  if (qty <= 0) return;
  await addDoc(collection(db, "stockHistory"), {
    productId,
    name,
    qty,
    price,
    costPrice,
    byUserId,
    createdAt: Date.now(),
  });
}
