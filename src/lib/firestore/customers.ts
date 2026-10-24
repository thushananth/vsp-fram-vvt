"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeMobile, sendWelcomeSms } from "@/lib/sms";
import type { Customer, CustomerType } from "@/lib/types";

function toCustomer(id: string, data: Record<string, unknown>): Customer {
  return {
    id,
    name: (data.name as string) ?? "",
    type: data.type === "shop" ? "shop" : "person",
    mobileNumber: (data.mobileNumber as string) ?? "",
    remainingCredit: (data.remainingCredit as number) ?? 0,
    openingBalance: (data.openingBalance as number) ?? 0,
    advance: (data.advance as number) ?? 0,
    lastReminderAt: (data.lastReminderAt as number) ?? 0,
    autoNamed: data.autoNamed === true,
    active: data.active !== false,
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
  };
}

export function useCustomers(): { customers: Customer[]; loading: boolean } {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sorted in JS: an orderBy alongside the active filter would need a
    // composite index, and a shop's customer list is small.
    const q = query(collection(db, "customers"), where("active", "==", true));
    return onSnapshot(
      q,
      (snap) => {
        setCustomers(
          snap.docs
            .map((d) => toCustomer(d.id, d.data()))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setLoading(false);
      },
      (err) => {
        console.error("customers snapshot error", err);
        setLoading(false);
      },
    );
  }, []);

  return { customers, loading };
}

export function useCustomer(customerId: string | null): Customer | null {
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    if (!customerId) {
      setCustomer(null);
      return;
    }
    return onSnapshot(doc(db, "customers", customerId), (snap) => {
      setCustomer(snap.exists() ? toCustomer(snap.id, snap.data()) : null);
    });
  }, [customerId]);

  return customer;
}

/**
 * Add a customer. The id is known at once and the write is queued, so the till
 * can add one with no connection; `saved` settles when the server has it. A
 * welcome SMS follows once it lands — the server decides whether to send it
 * (setting on, valid number, really new).
 */
export function startCreateCustomer(params: {
  name: string;
  type: CustomerType;
  mobileNumber: string;
  autoNamed?: boolean;
}): { id: string; saved: Promise<void> } {
  const now = Date.now();
  const ref = doc(collection(db, "customers"));
  const saved = setDoc(ref, {
    ...params,
    autoNamed: params.autoNamed ?? false,
    // A customer created here starts clean; openingBalance is only ever
    // non-zero for the ones the Flutter migration brings across.
    remainingCredit: 0,
    openingBalance: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  saved.then(() => sendWelcomeSms({ customerId: ref.id })).catch((err) => console.warn("welcome SMS not sent", err));
  return { id: ref.id, saved };
}

export async function createCustomer(params: { name: string; type: CustomerType; mobileNumber: string }) {
  const { id, saved } = startCreateCustomer(params);
  await saved;
  return id;
}

/** Name, type and mobile only — a balance is never edited by hand. */
export async function updateCustomer(
  customerId: string,
  params: { name: string; type: CustomerType; mobileNumber: string },
) {
  await setDoc(
    doc(db, "customers", customerId),
    // A walk-in saved under their number stays "autoNamed" until someone types a real name.
    { ...params, autoNamed: normalizeMobile(params.name) !== null, updatedAt: Date.now() },
    { merge: true },
  );
}

/**
 * Soft delete. A customer with bills behind them is never really removed —
 * the bills would lose the name they point at.
 */
export async function deactivateCustomer(customerId: string) {
  await setDoc(
    doc(db, "customers", customerId),
    { active: false, updatedAt: Date.now() },
    { merge: true },
  );
}

export function matchesCustomerSearch(customer: Customer, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    customer.name.toLowerCase().includes(q) || customer.mobileNumber.includes(q)
  );
}
