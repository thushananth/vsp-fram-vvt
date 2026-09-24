"use client";

import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { requireServer } from "@/lib/requireServer";
import type { ReturnEntry } from "@/lib/types";

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return 0;
}

/** Every return ever logged, newest first — callers filter by date range themselves. */
export function useReturns(): { returns: ReturnEntry[]; loading: boolean } {
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "returns"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setReturns(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              date: data.date,
              productId: data.productId,
              qty: data.qty ?? 0,
              reason: data.reason ?? "Unsold",
              byUserId: data.byUserId ?? "",
              createdAt: toMillis(data.createdAt),
            } satisfies ReturnEntry;
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { returns, loading };
}

/**
 * Log a return — just the entry itself. It's a record for the report, not a
 * stock adjustment: what happens to the shelf count is up to whoever logs it,
 * the same as any other manual stock change.
 *
 * Online-only, like every write here that isn't a sale.
 */
export async function logReturn(params: {
  date: string;
  productId: string;
  name: string;
  qty: number;
  reason: ReturnEntry["reason"];
  byUserId: string;
}) {
  const { date, productId, qty, reason, byUserId } = params;
  return requireServer(
    setDoc(doc(collection(db, "returns")), {
      date,
      productId,
      qty,
      reason,
      byUserId,
      createdAt: serverTimestamp(),
    }),
    "Logging a return needs a connection — the server didn't answer. Nothing was recorded; try again.",
  );
}

/** Remove a logged return — for a mistaken entry, not a stock adjustment. */
export async function deleteReturn(id: string) {
  return requireServer(
    deleteDoc(doc(db, "returns", id)),
    "Deleting a return needs a connection — the server didn't answer. Nothing was changed; try again.",
  );
}
