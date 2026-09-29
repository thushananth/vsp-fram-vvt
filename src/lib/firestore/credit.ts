"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
  type Transaction,
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

/** Bills store a Firestore Timestamp; tolerate a plain number too. */
function millis(value: unknown): number {
  if (typeof value === "number") return value;
  return (value as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
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

/**
 * Undo one payment's effect on the ledger: give the allocated amount back to
 * whichever bills (or the opening balance) it was taken off, and add it back
 * to the customer's cached balance. Shared by delete and edit — edit is just
 * a reversal followed by a fresh allocation of the new amount.
 *
 * Reads only, returns what the caller needs to compute the write — kept
 * separate from the write itself so callers can read further (e.g. other
 * bills) before the transaction's first write.
 */
async function readReversal(tx: Transaction, payment: CreditPayment) {
  const customerRef = doc(db, "customers", payment.customerId);
  const customerSnap = await tx.get(customerRef);
  if (!customerSnap.exists()) throw new Error("Customer not found");
  const customer = customerSnap.data();

  const billAllocations = payment.allocations.filter((a) => a.billId);
  const billSnaps = await Promise.all(
    billAllocations.map((a) => tx.get(doc(db, "bills", a.billId as string))),
  );

  const reversedBills = billAllocations.map((a, i) => {
    const snap = billSnaps[i];
    const data = snap.exists() ? snap.data() : null;
    // A bill deleted — or voided — since the payment can't be given money
    // back: a void bill owes nothing by definition. Its allocation is dropped
    // from the reversed total rather than re-opening debt on it.
    const live = !!data && data.status !== "void";
    return {
      id: a.billId as string,
      exists: live,
      amount: live ? a.amount : 0,
      no: (data?.no as number) ?? 0,
      createdAt: millis(data?.createdAt),
      due: round2(((data?.due as number) ?? 0) + (live ? a.amount : 0)),
      paid: round2(((data?.paid as number) ?? 0) - (live ? a.amount : 0)),
    };
  });

  const openingPaid = payment.allocations.find((a) => !a.billId)?.amount ?? 0;
  const reversedOpeningBalance = round2(((customer.openingBalance as number) ?? 0) + openingPaid);
  // Only what actually goes back onto a live bill or the opening balance
  // returns to the balance — not the payment's full face value.
  const givenBack = round2(reversedBills.reduce((sum, b) => sum + b.amount, 0) + openingPaid);
  const reversedRemainingCredit = round2(((customer.remainingCredit as number) ?? 0) + givenBack);

  return { customerRef, customer, reversedBills, reversedOpeningBalance, reversedRemainingCredit };
}

/** Remove a credit payment entirely — the money goes back on the bills/balance it was taken off. */
export async function deleteCreditPayment(paymentId: string) {
  return requireServer(
    runTransaction(db, async (tx) => {
      const paymentRef = doc(db, "creditPayments", paymentId);
      const paymentSnap = await tx.get(paymentRef);
      if (!paymentSnap.exists()) throw new Error("Payment not found");
      const payment = toPayment(paymentSnap.id, paymentSnap.data());

      const { customerRef, reversedBills, reversedOpeningBalance, reversedRemainingCredit } =
        await readReversal(tx, payment);

      for (const bill of reversedBills) {
        if (!bill.exists) continue;
        tx.set(doc(db, "bills", bill.id), { due: bill.due, paid: bill.paid }, { merge: true });
      }
      tx.set(
        customerRef,
        { remainingCredit: reversedRemainingCredit, openingBalance: reversedOpeningBalance, updatedAt: Date.now() },
        { merge: true },
      );
      tx.delete(paymentRef);
    }),
    "Deleting this payment needs a connection — the server didn't answer. Nothing was changed; try again.",
  );
}

/**
 * Change a payment's amount and/or note. Reverses the old allocation, then
 * re-allocates the new amount across whatever is outstanding *now* (oldest
 * first, same as taking a fresh payment) — so it behaves correctly even if
 * other payments landed on this customer since the original one.
 */
export async function editCreditPayment(paymentId: string, params: { amount: number; note: string | null }) {
  const { amount, note } = params;
  if (!(amount > 0)) throw new Error("Enter an amount greater than zero");

  return requireServer(
    (async () => {
      const paymentRef = doc(db, "creditPayments", paymentId);
      const paymentSnap = await getDoc(paymentRef);
      if (!paymentSnap.exists()) throw new Error("Payment not found");
      const payment = toPayment(paymentSnap.id, paymentSnap.data());

      // Every other outstanding bill for this customer, read outside the
      // transaction like payCredit does — the web SDK can't query inside one.
      const candidates = await getDocs(query(collection(db, "bills"), where("customerId", "==", payment.customerId)));
      const otherIds = candidates.docs
        .map((d) => d.id)
        .filter((id) => !payment.allocations.some((a) => a.billId === id));

      return runTransaction(db, async (tx) => {
        const { customerRef, reversedBills, reversedOpeningBalance, reversedRemainingCredit } =
          await readReversal(tx, payment);

        // Other bills that weren't part of the original allocation might
        // still (or now) be outstanding — they're candidates for the new one.
        const otherSnaps = await Promise.all(otherIds.map((id) => tx.get(doc(db, "bills", id))));
        const otherBills = otherIds
          .map((id, i) => {
            const snap = otherSnaps[i];
            if (!snap.exists()) return null;
            const data = snap.data();
            if (data.status === "void") return null;
            return { id, due: (data.due as number) ?? 0, paid: (data.paid as number) ?? 0, no: (data.no as number) ?? 0, createdAt: data.createdAt?.toMillis?.() ?? 0 };
          })
          .filter((b): b is NonNullable<typeof b> => b !== null);

        const allOutstanding = [
          // Real number and date, so the fresh allocation is oldest-first
          // across these and the other bills alike.
          ...reversedBills.filter((b) => b.exists).map((b) => {
            const orig = payment.allocations.find((a) => a.billId === b.id)!;
            return { id: b.id, due: b.due, paid: b.paid, no: b.no, createdAt: b.createdAt, __origAmount: orig.amount };
          }),
          ...otherBills.map((b) => ({ ...b, __origAmount: 0 })),
        ];

        const lines = outstandingLines({
          bills: allOutstanding.map(
            (b) => ({ id: b.id, no: b.no, createdAt: b.createdAt, due: b.due, status: "paid" }) as Bill,
          ),
          openingBalance: reversedOpeningBalance,
        });

        const owed = round2(lines.reduce((sum, l) => sum + l.due, 0));
        if (owed <= 0) throw new Error("This customer owes nothing to allocate against");
        if (round2(amount) > owed) {
          throw new Error(`Payment cannot exceed the ${owed.toFixed(2)} outstanding`);
        }

        const newAllocations = allocate(amount, lines);

        // Written unconditionally, even at taken=0 — every bill here was
        // either reversed or is a fresh candidate, so its due/paid may differ
        // from what's currently stored either way.
        for (const bill of allOutstanding) {
          const taken = newAllocations.find((a) => a.billId === bill.id)?.amount ?? 0;
          tx.set(
            doc(db, "bills", bill.id),
            { due: round2(bill.due - taken), paid: round2(bill.paid + taken) },
            { merge: true },
          );
        }

        const newOpeningPaid = newAllocations.find((a) => !a.billId)?.amount ?? 0;
        tx.set(
          customerRef,
          {
            remainingCredit: Math.max(0, round2(reversedRemainingCredit - amount)),
            openingBalance: Math.max(0, round2(reversedOpeningBalance - newOpeningPaid)),
            updatedAt: Date.now(),
          },
          { merge: true },
        );

        tx.set(paymentRef, { amount: round2(amount), note, allocations: newAllocations, editedAt: Date.now() }, { merge: true });

        return { allocations: newAllocations };
      });
    })(),
    "Editing this payment needs a connection — the server didn't answer. Nothing was changed; try again.",
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
