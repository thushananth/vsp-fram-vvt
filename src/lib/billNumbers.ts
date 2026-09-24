"use client";

import { useEffect } from "react";
import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Bill numbering that survives an offline till.
 *
 * `counters/bills` can't be read-then-written without the network, so a device
 * doesn't ask for a number per sale — it *leases a block* of them while it is
 * online and hands them out locally. Two devices never collide because the
 * lease itself is taken in a transaction, and the numbers stay short and
 * human-readable on the receipt, unlike a device-prefixed id.
 */

const LEASE_KEY = "chickenfarm.billLease";
/** Numbers reserved per top-up — roughly two busy days of offline billing. */
const LEASE_SIZE = 500;
/** Top up whenever the block gets this thin and we happen to be online. */
const LOW_WATER = 200;

interface Lease {
  /** Next number to hand out. */
  next: number;
  /** Last number this device owns, inclusive. */
  end: number;
}

function readLease(): Lease | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Lease;
    if (typeof parsed?.next !== "number" || typeof parsed?.end !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLease(lease: Lease): void {
  try {
    window.localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
  } catch {
    // Storage blocked (private mode). The in-flight number is still valid;
    // the next one just starts a fresh lease.
  }
}

export interface BillNumber {
  no: number;
  /**
   * True when the number came from outside a real lease — a device that has
   * never been online, or one that burned through its whole block offline.
   * The bill is still saved; the number is just not guaranteed unique.
   */
  provisional: boolean;
}

/**
 * Take the next bill number. Synchronous and never touches the network, so a
 * sale can complete with the wifi down.
 */
export function takeBillNo(): BillNumber {
  const lease = readLease();

  if (lease && lease.next <= lease.end) {
    writeLease({ next: lease.next + 1, end: lease.end });
    return { no: lease.next, provisional: false };
  }

  if (lease) {
    // Block exhausted with no way to top up. Keep counting rather than refuse
    // the sale — a collision needs another device to also overrun its own
    // block, and a duplicate number is recoverable where a lost bill is not.
    writeLease({ next: lease.next + 1, end: lease.end });
    return { no: lease.next, provisional: true };
  }

  // No lease at all. DeviceGate makes this near-impossible (a till has to be
  // online once to be approved), so fall back to a clock-derived number that
  // is unique in practice and obviously out-of-band on the receipt.
  return { no: Math.floor(Date.now() / 1000), provisional: true };
}

/** How many numbers this device can still issue offline. */
export function leaseRemaining(): number {
  const lease = readLease();
  if (!lease) return 0;
  return Math.max(0, lease.end - lease.next + 1);
}

/**
 * Reserve the next block of numbers. Online-only by nature — it hangs, rather
 * than failing, with no connection, so callers must not await it on a path
 * that has to stay responsive.
 */
let refillInFlight: Promise<void> | null = null;

export function refillLease(): Promise<void> {
  // A transaction on a dead connection never settles, so without this guard
  // every "online" event would stack another one and burn a block each time
  // the network flickers.
  if (!refillInFlight) {
    refillInFlight = reserveBlock().finally(() => {
      refillInFlight = null;
    });
  }
  return refillInFlight;
}

async function reserveBlock(): Promise<void> {
  const counterRef = doc(db, "counters", "bills");
  const end = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const seq = (snap.data()?.seq ?? 0) as number;
    const reservedEnd = seq + LEASE_SIZE;
    tx.set(counterRef, { seq: reservedEnd }, { merge: true });
    return reservedEnd;
  });

  const lease = readLease();
  const start = end - LEASE_SIZE + 1;

  // A fresh block that carries straight on from the old one just extends it;
  // otherwise the old block's leftovers are abandoned. Gaps in bill numbers
  // are cheap, duplicates are not.
  if (lease && lease.next <= lease.end && start === lease.end + 1) {
    writeLease({ next: lease.next, end });
  } else {
    writeLease({ next: start, end });
  }
}

/**
 * Reserve more numbers if the block is running thin. Fire-and-forget: offline
 * it hangs and is ignored, which is the whole point of holding a block.
 */
export function topUpLeaseIfLow(): void {
  if (leaseRemaining() >= LOW_WATER) return;
  refillLease().catch(() => {});
}

/**
 * Keeps a block of numbers banked — on mount, and whenever the browser says
 * the network came back. A busy till that eats into its block mid-session is
 * topped up by createBill instead, so it never has to wait for a reload.
 */
export function useBillNumberLease(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    topUpLeaseIfLow();
    window.addEventListener("online", topUpLeaseIfLow);
    return () => window.removeEventListener("online", topUpLeaseIfLow);
  }, [enabled]);
}
