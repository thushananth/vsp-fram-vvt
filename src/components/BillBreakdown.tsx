"use client";

import { lineAmount } from "@/lib/billLines";
import { dateAndTime, money } from "@/lib/format";
import type { Bill, CreditPayment } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Everything taken off a bill so far: cash and advance at the till, and credit payments since. */
export function paidSoFar(bill: Bill): number {
  return r2(bill.total - bill.due);
}

export type BillState = "paid" | "partial" | "unpaid" | "deleted";

/** Where a bill stands: settled, part paid, nothing paid yet, or deleted. */
export function billState(bill: Bill): BillState {
  if (bill.status === "void") return "deleted";
  if (bill.due <= 0.005) return "paid";
  return paidSoFar(bill) > 0.005 ? "partial" : "unpaid";
}

export const BILL_STATE_LABEL: Record<BillState, string> = {
  paid: "Paid",
  partial: "Partly paid",
  unpaid: "Unpaid",
  deleted: "Deleted",
};

export const BILL_STATE_STYLE: Record<BillState, string> = {
  paid: "bg-success/10 text-success",
  partial: "bg-warning/10 text-warning",
  unpaid: "bg-danger/10 text-danger",
  deleted: "bg-ground text-muted-2",
};

/**
 * One credit bill opened up: what was bought, then every amount that has come
 * off it — at the till, from advance, and each credit payment since — down to
 * what is still due.
 */
export default function BillBreakdown({ bill, payments }: { bill: Bill; payments: CreditPayment[] }) {
  const paidLater = payments
    .flatMap((p) =>
      p.allocations
        .filter((a) => a.billId === bill.id && a.amount > 0)
        .map((a) => ({ id: `${p.id}-${a.billId}`, at: p.createdAt, amount: a.amount, method: p.method })),
    )
    .sort((a, b) => a.at - b.at);
  // A credit payment is added onto the bill's `paid` as it lands, so `paid` is
  // the till's cash *plus* every later payment. What was handed over at the
  // till is what is left after taking those back out.
  const later = paidLater.reduce((sum, p) => sum + p.amount, 0);
  const atTill = Math.max(0, Math.round((bill.paid - later) * 100) / 100);
  // Paid but not traceable to a dated payment — e.g. the old app's payments,
  // which were brought across without saying which bill they cleared.
  const untraced = Math.round((bill.total - bill.advanceUsed - bill.paid - bill.due) * 100) / 100;

  return (
    <div className="border-t border-border px-3.5 pb-3 pt-2">
      <div className="flex gap-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-2">
        <div className="flex-1">Item</div>
        <div className="w-24 text-right">Qty × price</div>
        <div className="w-20 text-right">Amount</div>
      </div>
      {bill.lines.map((l, i) => (
        <div key={i} className="flex gap-2 border-b border-border/60 py-1.5 last:border-b-0">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{l.name}</div>
          <div className="tabular-nums w-24 text-right text-xs font-medium text-muted">
            {l.qty} × {money(l.price)}
          </div>
          <div className="tabular-nums w-20 text-right text-sm font-bold">{money(lineAmount(l))}</div>
        </div>
      ))}

      <div className="tabular-nums mt-2 flex flex-col gap-1 rounded-lg bg-ground px-3 py-2 text-xs font-semibold">
        {bill.discount > 0 && (
          <div className="flex justify-between text-muted">
            <span>Round-off</span>
            <span>−{money(bill.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-extrabold">
          <span>Bill total</span>
          <span>{money(bill.total)}</span>
        </div>
        {bill.advanceUsed > 0 && (
          <div className="flex justify-between text-success">
            <span>Advance used at the till</span>
            <span>−{money(bill.advanceUsed)}</span>
          </div>
        )}
        {atTill > 0 && (
          <div className="flex justify-between text-success">
            <span>Paid at the till · {dateAndTime(bill.createdAt)}</span>
            <span>−{money(atTill)}</span>
          </div>
        )}
        {paidLater.map((p) => (
          <div key={p.id} className="flex justify-between text-success">
            <span>
              {p.method === "advance" ? "From advance" : "Paid"} · {dateAndTime(p.at)}
            </span>
            <span>−{money(p.amount)}</span>
          </div>
        ))}
        {untraced > 0 && bill.status !== "void" && (
          <div className="flex justify-between text-success">
            <span>Paid earlier (no date on record)</span>
            <span>−{money(untraced)}</span>
          </div>
        )}
        {bill.status === "void" ? (
          <div className="border-t border-border pt-1 text-sm font-extrabold text-muted-2">
            Deleted · not counted in any total
          </div>
        ) : (
          <div
            className={`flex justify-between border-t border-border pt-1 text-sm font-extrabold ${
              bill.due > 0 ? "text-warning" : "text-success"
            }`}
          >
            <span>{bill.due > 0 ? "Still due" : "Fully paid"}</span>
            <span>{money(bill.due)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
