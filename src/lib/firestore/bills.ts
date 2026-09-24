"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { takeBillNo, topUpLeaseIfLow } from "@/lib/billNumbers";
import { clearEntry, markFailed, recordPending, type JournalEntry } from "@/lib/billJournal";
import { requireServer } from "@/lib/requireServer";
import type { Bill, BillLine, PaymentType } from "@/lib/types";

export interface CreatedBill {
  id: string;
  no: number;
  /** The number came from outside a real lease — see billNumbers.ts. */
  provisional: boolean;
  /**
   * Resolves when the server has accepted the bill, rejects if it refuses it.
   * Offline it simply never settles, so the till must never await it — the
   * sale is already complete once createBill returns.
   */
  accepted: Promise<void>;
}

interface BillDraft {
  id: string;
  no: number;
  provisional: boolean;
  createdAt: number;
  lines: BillLine[];
  total: number;
  /**
   * What the customer actually handed over. Equal to `total` on a normal cash
   * sale, 0 on a full credit bill, and somewhere between on a short payment —
   * the rest becomes `due` and goes onto the customer's balance.
   */
  paid: number;
  tender: number;
  change: number;
  cashierId: string;
  paymentType: PaymentType;
  customerId: string | null;
  customerName: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The one place `paid` and `due` are derived, so a bill written at the till and
 * the same bill re-sent from the journal can never disagree about the money.
 */
function settlement(draft: { total: number; paid: number }): { paid: number; due: number } {
  const paid = round2(Math.min(Math.max(0, draft.paid), draft.total));
  return { paid, due: round2(draft.total - paid) };
}

/**
 * Build and send the write for one bill. A batch — not a transaction — because
 * `runTransaction` needs a server round-trip and so cannot run offline at all,
 * while `writeBatch` applies to the local cache immediately and flushes when
 * the connection comes back. The counters and balances it touches use
 * `increment()`, which is safe to queue: two tills that were both offline
 * merge correctly instead of overwriting each other.
 *
 * Deliberately not `async`: an async function would await `batch.commit()` on
 * the way out and flatten the returned promise, which is exactly the hang this
 * whole path exists to avoid. It hands the pending commit back to the caller.
 */
function commitBill(draft: BillDraft): Promise<void> {
  const { paid, due } = settlement(draft);

  const batch = writeBatch(db);

  batch.set(doc(db, "bills", draft.id), {
    no: draft.no,
    // The till's own clock, not serverTimestamp(): on an offline sale the
    // server timestamp would record when the wifi came back, not when the
    // customer paid, and it reads back as 0 until then.
    createdAt: Timestamp.fromMillis(draft.createdAt),
    syncedAt: serverTimestamp(),
    cashierId: draft.cashierId,
    lines: draft.lines,
    total: draft.total,
    tender: draft.tender,
    change: draft.change,
    status: "paid",
    // Kept for the Flutter app, which still reads it. The UI's own queued/
    // synced badge comes from snapshot metadata instead — see toBill.
    synced: true,
    provisionalNo: draft.provisional,
    customerId: draft.customerId,
    customerName: draft.customerName,
    paymentType: draft.paymentType,
    paid,
    due,
  });

  // Only the unpaid remainder goes on the balance — a bill part-settled at the
  // till must not put its whole total on the customer's account.
  if (due > 0 && draft.customerId) {
    batch.set(
      doc(db, "customers", draft.customerId),
      { remainingCredit: increment(due), updatedAt: Date.now() },
      { merge: true },
    );
  }

  return batch.commit();
}

/**
 * Create a bill. Returns as soon as the write is in the local queue, so the
 * till stays usable with no connection — the bill is durable at that point,
 * and Firestore flushes it when the network returns.
 */
export function createBill(params: {
  lines: BillLine[];
  total: number;
  tender: number;
  change: number;
  cashierId: string;
  paymentType: PaymentType;
  customerId: string | null;
  customerName: string | null;
  paid: number;
}): CreatedBill {
  // A backstop, not the user-facing check — the till blocks a short payment
  // from a walk-in before it ever gets here, with a warning the cashier reads.
  if (params.paid < params.total && !params.customerId) {
    throw new Error("Money left owing needs a customer to owe it");
  }

  const { no, provisional } = takeBillNo();
  const draft: BillDraft = {
    id: doc(collection(db, "bills")).id,
    no,
    provisional,
    createdAt: Date.now(),
    ...params,
  };

  recordPending(draft);
  const commit = commitBill(draft);

  const accepted = commit.then(
    () => clearEntry(draft.id),
    (err: unknown) => {
      // A queued write the server later refuses would otherwise vanish
      // without trace. Park it in the journal so it can be exported or retried.
      markFailed(draft.id, (err as Error).message);
      throw err;
    },
  );

  // Keep the block stocked while the connection is good, so a till that sells
  // through its lease mid-shift isn't stranded when the wifi drops.
  topUpLeaseIfLow();

  return { id: draft.id, no, provisional, accepted };
}

/**
 * One in-flight re-send per bill. The wait below gives up after a few seconds
 * but the commit does not, and a second batch would apply a *second*
 * `increment()` — doubling the customer's balance.
 */
const resending = new Map<string, Promise<void>>();

/** Re-send a bill the server rejected, under its original id and number. */
export function retryJournalledBill(entry: JournalEntry): Promise<void> {
  let commit = resending.get(entry.id);

  if (!commit) {
    commit = commitBill(entry);
    resending.set(entry.id, commit);
    // The queued write outlives the button: if it lands after the wait below
    // has given up, the entry still clears itself.
    commit.then(
      () => {
        resending.delete(entry.id);
        clearEntry(entry.id);
      },
      (err: unknown) => {
        resending.delete(entry.id);
        markFailed(entry.id, (err as Error).message);
      },
    );
  }

  return requireServer(
    commit,
    "Still sending — the server hasn't answered yet. It will finish on its own once the connection is back.",
  );
}

/**
 * Void a bill — atomically. An unpaid credit bill also comes off the
 * customer's balance; what they already paid against it stays paid, since
 * that money genuinely changed hands.
 *
 * Online-only, unlike createBill: a void is a correction that can wait for the
 * connection, and the clamped give-back below has no offline-safe form.
 */
export async function voidBill(billId: string) {
  return requireServer(
    runTransaction(db, async (tx) => {
      const billRef = doc(db, "bills", billId);
      const billSnap = await tx.get(billRef);
      if (!billSnap.exists()) throw new Error("Bill not found");
      const bill = billSnap.data() as Bill;
      if (bill.status === "void") return;

      const outstanding = bill.due ?? 0;
      const customerRef = bill.customerId ? doc(db, "customers", bill.customerId) : null;
      let customerCredit = 0;
      if (customerRef && outstanding > 0) {
        const customerSnap = await tx.get(customerRef);
        customerCredit = customerSnap.data()?.remainingCredit ?? 0;
      }

      tx.set(billRef, { status: "void", due: 0 }, { merge: true });

      if (customerRef && outstanding > 0) {
        tx.set(
          customerRef,
          {
            remainingCredit: Math.max(0, customerCredit - outstanding),
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }
    }),
    "Voiding needs a connection — the server didn't answer. The bill is unchanged; try again.",
  );
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number") return value;
  return 0;
}

/**
 * Bills written before credit existed have no paymentType/paid/due, so they
 * read back as fully-paid cash sales rather than as free money owed.
 *
 * `synced` is not the stored field — a document can't know whether it reached
 * the server. It comes from the snapshot's own pending-write flag, which is
 * why every listener here passes `includeMetadataChanges`.
 */
function toBill(id: string, data: Record<string, unknown>, pending: boolean): Bill {
  const total = (data.total as number) ?? 0;
  const paymentType = data.paymentType === "credit" ? "credit" : "cash";
  return {
    id,
    no: (data.no as number) ?? 0,
    createdAt: toMillis(data.createdAt),
    cashierId: (data.cashierId as string) ?? "",
    lines: (data.lines ?? []) as BillLine[],
    total,
    tender: (data.tender as number) ?? 0,
    change: (data.change as number) ?? 0,
    status: data.status === "void" ? "void" : "paid",
    synced: !pending,
    customerId: (data.customerId as string) ?? null,
    customerName: (data.customerName as string) ?? null,
    paymentType,
    paid: (data.paid as number) ?? total,
    due: (data.due as number) ?? 0,
  };
}

export function useBills(): { bills: Bill[]; loading: boolean } {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "bills"), orderBy("createdAt", "desc"));
    // Without includeMetadataChanges the listener never re-fires when a queued
    // write is acknowledged, so the "Queued" badge would never clear.
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setBills(snap.docs.map((d) => toBill(d.id, d.data(), d.metadata.hasPendingWrites)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { bills, loading };
}

/** Every bill for one customer, newest first — their statement. */
export function useCustomerBills(customerId: string | null): {
  bills: Bill[];
  loading: boolean;
} {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customerId) {
      setBills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Single-field filter, sorted client-side: an orderBy here would need a
    // composite index, and one customer's bills are few enough to sort in JS.
    const q = query(collection(db, "bills"), where("customerId", "==", customerId));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        setBills(
          snap.docs
            .map((d) => toBill(d.id, d.data(), d.metadata.hasPendingWrites))
            .sort((a, b) => b.createdAt - a.createdAt),
        );
        setLoading(false);
      },
      (err) => {
        console.error("customer bills snapshot error", err);
        setLoading(false);
      },
    );
  }, [customerId]);

  return { bills, loading };
}
