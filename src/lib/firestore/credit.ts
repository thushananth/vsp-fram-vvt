"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { requireServer } from "@/lib/requireServer";
import type { Bill, CreditAllocation, CreditPayment } from "@/lib/types";

/** A settleable line on the credit screen: a bill, or the opening balance. */
export interface OutstandingLine {
  billId: string | null;
  billNo: number | null;
  label: string;
  createdAt: number;
  due: number;
}

/**
 * What the customer owes, oldest first, with the opening balance last — the
 * same order payCredit settles them in, so the screen and the write agree.
 */
export function outstandingLines(params: {
  bills: Bill[];
  openingBalance: number;
}): OutstandingLine[] {
  const { bills, openingBalance } = params;
  // Bills carry the till's own clock, so an offline one sorts correctly. A 0
  // only shows up on legacy rows with no usable timestamp; those sort last
  // rather than jumping to the front of the queue as the oldest debt.
  const age = (createdAt: number) => (createdAt > 0 ? createdAt : Number.MAX_SAFE_INTEGER);
  const lines: OutstandingLine[] = bills
    .filter((b) => b.status !== "void" && b.due > 0)
    .sort((a, b) => age(a.createdAt) - age(b.createdAt))
    .map((b) => ({
      billId: b.id,
      billNo: b.no,
      label: `Bill #${b.no}`,
      createdAt: b.createdAt,
      due: b.due,
    }));

  if (openingBalance > 0) {
    lines.push({
      billId: null,
      billNo: null,
      label: "Opening balance (before migration)",
      createdAt: 0,
      due: openingBalance,
    });
  }

  return lines;
}

/** Split an amount across lines in order, oldest bill first. */
export function allocate(amount: number, lines: OutstandingLine[]): CreditAllocation[] {
  let left = round2(amount);
  const allocations: CreditAllocation[] = [];
  for (const line of lines) {
    if (left <= 0) break;
    const take = round2(Math.min(left, line.due));
    if (take <= 0) continue;
    allocations.push({ billId: line.billId, billNo: line.billNo, amount: take });
    left = round2(left - take);
  }
  return allocations;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Take a payment off a customer's balance, oldest bill first, opening balance
 * last. One transaction: the bills, the customer's cached balance and the
 * payment record either all land or none do.
 *
 * The web SDK can't run a query inside a transaction, so the candidate bills
 * are listed first and then re-read by reference inside it — a bill that was
 * paid or voided in between is simply skipped on the fresh read.
 *
 * Online-only, unlike createBill: a transaction has no offline form, and
 * settling a debt is a back-office correction that can wait for the connection
 * in a way that a sale at the counter cannot.
 */
export async function payCredit(params: {
  customerId: string;
  amount: number;
  receivedBy: string;
  note: string | null;
}): Promise<{ id: string; allocations: CreditAllocation[] }> {
  const { customerId, amount, receivedBy, note } = params;
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero");

  const candidates = await requireServer(
    getDocs(query(collection(db, "bills"), where("customerId", "==", customerId))),
    "Taking a payment needs a connection — the server didn't answer. Nothing was recorded; try again.",
  );
  const candidateIds = candidates.docs
    .filter((d) => (d.data().due ?? 0) > 0 && d.data().status !== "void")
    .map((d) => d.id);

  return requireServer(
    runTransaction(db, async (tx) => {
      // Every read before the first write — a transaction rule.
      const customerRef = doc(db, "customers", customerId);
      const customerSnap = await tx.get(customerRef);
      if (!customerSnap.exists()) throw new Error("Customer not found");
      const customer = customerSnap.data();
      const customerName = (customer.name as string) ?? "";
      const openingBalance = (customer.openingBalance as number) ?? 0;

      const fresh: { id: string; no: number; total: number; paid: number; due: number; createdAt: number }[] =
        [];
      for (const id of candidateIds) {
        const snap = await tx.get(doc(db, "bills", id));
        const data = snap.data();
        if (!data || data.status === "void") continue;
        const due = (data.due as number) ?? 0;
        if (due <= 0) continue;
        fresh.push({
          id,
          no: (data.no as number) ?? 0,
          total: (data.total as number) ?? 0,
          paid: (data.paid as number) ?? 0,
          due,
          createdAt: data.createdAt?.toMillis?.() ?? 0,
        });
      }

      const lines = outstandingLines({
        bills: fresh.map(
          (b) =>
            ({
              id: b.id,
              no: b.no,
              createdAt: b.createdAt,
              due: b.due,
              status: "paid",
            }) as Bill,
        ),
        openingBalance,
      });

      const owed = round2(lines.reduce((sum, l) => sum + l.due, 0));
      if (owed <= 0) throw new Error("This customer owes nothing");
      if (round2(amount) > owed) {
        throw new Error(`Payment cannot exceed the ${owed.toFixed(2)} outstanding`);
      }

      const allocations = allocate(amount, lines);
      const applied = round2(allocations.reduce((sum, a) => sum + a.amount, 0));

      for (const allocation of allocations) {
        if (!allocation.billId) continue;
        const bill = fresh.find((b) => b.id === allocation.billId)!;
        tx.set(
          doc(db, "bills", bill.id),
          {
            paid: round2(bill.paid + allocation.amount),
            due: round2(bill.due - allocation.amount),
          },
          { merge: true },
        );
      }

      const openingPaid = allocations.find((a) => a.billId === null)?.amount ?? 0;
      tx.set(
        customerRef,
        {
          // Clamped: if the cache had drifted below what the bills say, the
          // payment must not push the balance negative.
          remainingCredit: Math.max(
            0,
            round2(((customer.remainingCredit as number) ?? 0) - applied),
          ),
          openingBalance: Math.max(0, round2(openingBalance - openingPaid)),
          updatedAt: Date.now(),
        },
        { merge: true },
      );

      const paymentRef = doc(collection(db, "creditPayments"));
      tx.set(paymentRef, {
        customerId,
        customerName,
        amount: applied,
        method: "cash",
        allocations,
        receivedBy,
        createdAt: Date.now(),
        note,
      });

      return { id: paymentRef.id, allocations };
    }),
    // Deliberately not "try again": the transaction can't be cancelled, so a
    // payment that times out here may still land. Retrying it blind would
    // credit the customer twice.
    "The server didn't answer. This payment may still have gone through — check the customer's payment history before taking it again.",
  );
}

function toPayment(id: string, data: Record<string, unknown>): CreditPayment {
  return {
    id,
    customerId: (data.customerId as string) ?? "",
    customerName: (data.customerName as string) ?? "",
    amount: (data.amount as number) ?? 0,
    method: "cash",
    allocations: (data.allocations ?? []) as CreditAllocation[],
    receivedBy: (data.receivedBy as string) ?? "",
    createdAt: (data.createdAt as number) ?? 0,
    note: (data.note as string) ?? null,
  };
}

/** Payment history — the whole shop's, or one customer's. */
export function useCreditPayments(customerId?: string | null): {
  payments: CreditPayment[];
  loading: boolean;
} {
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Filtering by customer sorts in JS instead of adding an orderBy, which
    // would need a composite index for the pair.
    const q = customerId
      ? query(collection(db, "creditPayments"), where("customerId", "==", customerId))
      : query(collection(db, "creditPayments"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setPayments(
          snap.docs
            .map((d) => toPayment(d.id, d.data()))
            .sort((a, b) => b.createdAt - a.createdAt),
        );
        setLoading(false);
      },
      (err) => {
        console.error("creditPayments snapshot error", err);
        setLoading(false);
      },
    );
  }, [customerId]);

  return { payments, loading };
}
