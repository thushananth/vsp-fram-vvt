"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
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

export function useReturns(date: string): { returns: ReturnEntry[]; loading: boolean } {
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "returns"),
      where("date", "==", date),
      orderBy("createdAt", "desc"),
    );
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
  }, [date]);

  return { returns, loading };
}

/**
 * Log a return: writes the return doc and adds to the day's returned count
 * together, so the day-end table can never disagree with the return log.
 *
 * Online-only. A transaction has no offline form, and unlike a sale a return
 * is end-of-day paperwork that can wait for the connection.
 */
export async function logReturn(params: {
  date: string;
  productId: string;
  name: string;
  qty: number;
  reason: ReturnEntry["reason"];
  byUserId: string;
}) {
  const { date, productId, name, qty, reason, byUserId } = params;
  return requireServer(
    runTransaction(db, async (tx) => {
      const returnRef = doc(collection(db, "returns"));
      tx.set(returnRef, {
        date,
        productId,
        qty,
        reason,
        byUserId,
        createdAt: serverTimestamp(),
      });

      const dayItemRef = doc(db, "bakeryDays", date, "items", productId);
      const snap = await tx.get(dayItemRef);
      tx.set(
        dayItemRef,
        {
          name,
          received: snap.data()?.received ?? 0,
          sold: snap.data()?.sold ?? 0,
          returned: (snap.data()?.returned ?? 0) + qty,
        },
        { merge: true },
      );
    }),
    "Logging a return needs a connection — the server didn't answer. Nothing was recorded; try again.",
  );
}
