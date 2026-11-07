import { round2 } from "@/lib/billLines";
import { billLabel } from "@/lib/orders";
import type { Bill, BillLine, CreditPayment } from "@/lib/types";
import { clock } from "./dates";
import { priceOverride } from "./schema";

/**
 * Cash check: a cashier's drawer is short at day end. Works out the cash that
 * should be there and lists the bills that could explain the gap, most likely
 * first. Everything here is arithmetic on the day's records; Gemini only
 * explains the result, and the wording is always "bills to check".
 *
 * Owner's rules (7 Nov 2026): counted per cashier, no opening float; a voided
 * bill's cash is handed back, so voids are left out of expected cash, but a
 * void whose amount matches the shortage is still listed.
 */

/** Amounts this close to the shortage count as a match (a walk-in round-off). */
export const MATCH_TOLERANCE = 20;
/** Two identical bills this close together look like one sale entered twice. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const MAX_CANDIDATES = 12;
const MAX_PAIRS = 5;
const MAX_TRIPLES = 3;
/** Triples are only searched on a day small enough to do it quickly. */
const TRIPLE_SEARCH_LIMIT = 80;

export type Strength = "high" | "medium" | "low";

export type CandidateKind =
  | "change"
  | "same-amount"
  | "pair"
  | "triple"
  | "void"
  | "part-credit"
  | "price-override"
  | "round-off"
  | "large-change"
  | "duplicate"
  | "not-on-server";

export interface Candidate {
  kind: CandidateKind;
  strength: Strength;
  /** The bills involved, in time order. */
  bills: { id: string; label: string; time: string; amount: number }[];
  /** The amount compared with the shortage. */
  amount: number;
  /** How far `amount` is from the shortage. */
  off: number;
  reason: string;
}

export interface CashCheckResult {
  day: string;
  shortBy: number;
  expected: {
    billsPaid: number;
    payments: number;
    total: number;
    bills: number;
    cashPayments: number;
    voids: number;
    voidPaid: number;
  };
  candidates: Candidate[];
  /** Pairs found beyond those listed. */
  morePairs: number;
}

/** A bill written on a tablet that the server hasn't confirmed (bill journal). */
export interface UnsentBill {
  id: string;
  no: number;
  createdAt: number;
  cashierId: string;
  total: number;
  paid: number;
  kind?: "order";
  state: "pending" | "failed";
}

const rank: Record<Strength, number> = { high: 3, medium: 2, low: 1 };
const rs = (n: number) => `Rs ${round2(n).toLocaleString("en-LK")}`;

function ref(b: Pick<Bill, "id" | "no" | "kind" | "createdAt">, amount: number) {
  return { id: b.id, label: billLabel(b), time: clock(b.createdAt), amount: round2(amount) };
}

function lineKey(lines: BillLine[]): string {
  return lines
    .map((l) => `${l.productId}|${l.qty}|${l.price}|${l.amount ?? ""}`)
    .sort()
    .join(";");
}

export function cashCheck(params: {
  day: string;
  cashierId: string;
  shortBy: number;
  /** That day's bills, any cashier. */
  bills: Bill[];
  /** That day's credit payments, any cashier. */
  payments: CreditPayment[];
  /** This device's unconfirmed bills, if any. */
  unsent?: UnsentBill[];
}): CashCheckResult {
  const shortBy = Math.abs(params.shortBy);
  const matches = (n: number) => Math.abs(n - shortBy) <= MATCH_TOLERANCE;
  const off = (n: number) => round2(Math.abs(n - shortBy));

  const mine = params.bills
    .filter((b) => b.cashierId === params.cashierId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const live = mine.filter((b) => b.status !== "void");
  const voids = mine.filter((b) => b.status === "void");
  const cashPayments = params.payments.filter(
    (p) => p.receivedBy === params.cashierId && p.method !== "advance" && !p.imported,
  );

  const billsPaid = round2(live.reduce((s, b) => s + b.paid, 0));
  const paymentsIn = round2(cashPayments.reduce((s, p) => s + p.amount, 0));

  const out: Candidate[] = [];
  const add = (c: Omit<Candidate, "off"> & { off?: number }) => out.push({ ...c, off: c.off ?? off(c.amount) });

  for (const b of live) {
    // Change that doesn't fit the tender. Exact-cash sales store tender 0 and
    // short payments give no change, so only a real tender is checked.
    if (b.tender > 0 && b.tender >= b.paid) {
      const should = round2(b.tender - b.paid);
      const extra = round2(b.change - should);
      if (Math.abs(extra) > 0.5) {
        add({
          kind: "change",
          strength: matches(extra) ? "high" : extra > 0 ? "medium" : "low",
          bills: [ref(b, b.paid)],
          amount: extra,
          reason: `Tender ${rs(b.tender)}, change given ${rs(b.change)}. Should be ${rs(should)}.`,
        });
      } else if (b.change >= 2000) {
        add({
          kind: "large-change",
          strength: matches(b.change) ? "medium" : "low",
          bills: [ref(b, b.paid)],
          amount: b.change,
          reason: `Large change given: ${rs(b.change)} from ${rs(b.tender)}.`,
        });
      }
    }

    if (b.paid > 0 && matches(b.paid)) {
      add({
        kind: "same-amount",
        strength: "high",
        bills: [ref(b, b.paid)],
        amount: b.paid,
        reason: `${b.paymentType === "credit" ? "Credit bill part-paid" : "Cash bill"} for ${rs(b.paid)}, about the short amount.`,
      });
    } else if (matches(b.total) && b.total !== b.paid) {
      add({
        kind: "same-amount",
        strength: "medium",
        bills: [ref(b, b.total)],
        amount: b.total,
        reason: `Bill total ${rs(b.total)} matches, but only ${rs(b.paid)} was taken in cash.`,
      });
    }

    if (b.paymentType === "credit" && b.paid > 0 && !matches(b.paid)) {
      add({
        kind: "part-credit",
        strength: "low",
        bills: [ref(b, b.paid)],
        amount: b.paid,
        reason: `Credit bill part-paid ${rs(b.paid)} at the till. Check the cash was collected.`,
      });
    }

    const override = priceOverride(b);
    if (override > 0) {
      add({
        kind: "price-override",
        strength: matches(override) ? "high" : "low",
        bills: [ref(b, b.paid)],
        amount: override,
        reason: `Price changed at the till: ${rs(override)} below list price.`,
      });
    }

    if (b.discount > 0 && matches(b.discount)) {
      add({
        kind: "round-off",
        strength: "medium",
        bills: [ref(b, b.paid)],
        amount: b.discount,
        reason: `Round-off of ${rs(b.discount)} given.`,
      });
    }
  }

  for (const b of voids) {
    if (b.paid <= 0) continue;
    add({
      kind: "void",
      strength: matches(b.paid) ? "high" : "low",
      bills: [ref(b, b.paid)],
      amount: b.paid,
      reason: `Voided after ${rs(b.paid)} cash was taken. Check it was handed back.`,
    });
  }

  // Duplicates: same lines and total, minutes apart.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (b.createdAt - a.createdAt > DUPLICATE_WINDOW_MS) break;
      if (a.total !== b.total || lineKey(a.lines) !== lineKey(b.lines)) continue;
      add({
        kind: "duplicate",
        strength: matches(a.total) ? "high" : "medium",
        bills: [ref(a, a.paid), ref(b, b.paid)],
        amount: a.total,
        reason: `Two bills with the same items and total, ${Math.round((b.createdAt - a.createdAt) / 60_000)} min apart.`,
      });
    }
  }

  // Combinations of cash taken that add up to the shortage.
  const cash = live.filter((b) => b.paid > 0 && b.paid < shortBy + MATCH_TOLERANCE);
  const pairs: Candidate[] = [];
  for (let i = 0; i < cash.length; i++) {
    for (let j = i + 1; j < cash.length; j++) {
      const sum = cash[i].paid + cash[j].paid;
      if (!matches(sum)) continue;
      pairs.push({
        kind: "pair",
        strength: "medium",
        bills: [ref(cash[i], cash[i].paid), ref(cash[j], cash[j].paid)],
        amount: round2(sum),
        off: off(sum),
        reason: `Two cash bills, ${rs(cash[i].paid)} and ${rs(cash[j].paid)}, add up to it.`,
      });
    }
  }
  // Closest sum first, then the two bills closest in time (one missed handover).
  const gap = (c: Candidate) => Math.abs(timeOf(c, 1) - timeOf(c, 0));
  pairs.sort((a, b) => a.off - b.off || gap(a) - gap(b));
  out.push(...pairs.slice(0, MAX_PAIRS));

  if (cash.length <= TRIPLE_SEARCH_LIMIT) {
    const triples: Candidate[] = [];
    for (let i = 0; i < cash.length; i++) {
      for (let j = i + 1; j < cash.length; j++) {
        for (let k = j + 1; k < cash.length; k++) {
          const sum = cash[i].paid + cash[j].paid + cash[k].paid;
          if (!matches(sum)) continue;
          triples.push({
            kind: "triple",
            strength: "low",
            bills: [ref(cash[i], cash[i].paid), ref(cash[j], cash[j].paid), ref(cash[k], cash[k].paid)],
            amount: round2(sum),
            off: off(sum),
            reason: `Three cash bills add up to ${rs(sum)}.`,
          });
        }
      }
    }
    triples.sort((a, b) => a.off - b.off);
    out.push(...triples.slice(0, MAX_TRIPLES));
  }

  // Bills this tablet wrote that the server hasn't confirmed yet.
  const onServer = new Set(params.bills.map((b) => b.id));
  for (const u of params.unsent ?? []) {
    if (u.cashierId !== params.cashierId || onServer.has(u.id)) continue;
    add({
      kind: "not-on-server",
      strength: matches(u.paid) ? "high" : "medium",
      bills: [{ id: u.id, label: billLabel(u), time: clock(u.createdAt), amount: round2(u.paid) }],
      amount: u.paid,
      reason:
        u.state === "failed"
          ? `Held on this tablet: the server refused it, so it isn't in the day's bills.`
          : `Still queued on this tablet, not yet in the day's bills.`,
    });
  }

  out.sort((a, b) => rank[b.strength] - rank[a.strength] || a.off - b.off || timeOf(a, 0) - timeOf(b, 0));

  return {
    day: params.day,
    shortBy,
    expected: {
      billsPaid,
      payments: paymentsIn,
      total: round2(billsPaid + paymentsIn),
      bills: live.length,
      cashPayments: cashPayments.length,
      voids: voids.length,
      voidPaid: round2(voids.reduce((s, b) => s + b.paid, 0)),
    },
    candidates: out.slice(0, MAX_CANDIDATES),
    morePairs: Math.max(0, pairs.length - MAX_PAIRS),
  };
}

/** Minutes since midnight of a candidate's nth bill, from its "HH:MM". */
function timeOf(c: Candidate, n: number): number {
  const t = c.bills[Math.min(n, c.bills.length - 1)]?.time ?? "00:00";
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
