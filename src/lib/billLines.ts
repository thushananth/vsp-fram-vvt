import type { BillLine } from "@/lib/types";

/**
 * What a line charges. A line sold by amount ("Rs 1500 of chicken") charges
 * exactly that amount: its quantity is rounded to the gram, so price × qty can
 * land a few cents off (1500.45) and must not be what the customer pays.
 */
export function lineAmount(l: Pick<BillLine, "price" | "qty" | "amount">): number {
  return l.amount ?? Math.round(l.price * l.qty * 100) / 100;
}

/** Money, not floating point — 0.1 + 0.2 has no place on a receipt. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Quantities to the gram. Weighed goods sell as 2.5 or 0.266, and plain float
 * arithmetic turns 2.266 - 1 into 1.2659999999999998 on the bill.
 */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
