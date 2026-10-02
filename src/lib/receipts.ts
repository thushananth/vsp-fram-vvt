"use client";

import { SHOP_DETAILS } from "@/lib/constants";
import { Ticket, columnsFor } from "@/lib/printer";
import type { Bill, BillLine, Category, Product } from "@/lib/types";

/** "1 375.00" — two decimals, no currency, the way the old receipts read. */
function amt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface ReceiptContext {
  paperWidth: 58 | 80;
  /** product id → unit ("kg", "pcs"), printed beside the quantity. */
  unitOf: (productId: string) => string;
  cashierName?: string;
  /** The customer's balance *before* this bill, for the credit footer. */
  previousBalance?: number;
  reprint?: boolean;
}

/** Big bill number in the top corner, as the old app printed its reference. */
function billNumber(t: Ticket, bill: Bill, reprint?: boolean) {
  t.align("right").size(2, 2).bold(true);
  t.line(`${reprint ? "REPRINT " : ""}#${bill.no}`);
  t.size(1, 1).bold(false);
}

function letterhead(t: Ticket) {
  t.align("center").bold(true).size(2, 2).line(SHOP_DETAILS.name).size(1, 1).bold(false);
  t.line(SHOP_DETAILS.address);
  t.line(SHOP_DETAILS.phone);
  t.feed(1).align("left");
}

function lineCells(l: BillLine, unit: string, wide: boolean) {
  const name = wide ? `${l.name} (${Math.round(l.price)})` : l.name;
  return [name, `${qty(l.qty)} ${unit}`, amt(l.price * l.qty)];
}

/** The customer's receipt. */
export function customerReceipt(bill: Bill, ctx: ReceiptContext): Ticket {
  const cols = columnsFor(ctx.paperWidth);
  const wide = cols >= 48;
  const t = new Ticket(cols);
  // Item | Qty | Total — the first column takes whatever the others leave.
  const widths = wide ? [cols - 12 - 12 - 2, -12, -12] : [cols - 9 - 10 - 2, -9, -10];

  billNumber(t, bill, ctx.reprint);
  letterhead(t);

  t.pair(`Customer: ${bill.customerName ?? "Walk-in"}`, "");
  t.line(`Date: ${stamp(bill.createdAt)}`);
  if (ctx.cashierName) t.line(`Cashier: ${ctx.cashierName}`);
  t.rule();
  t.bold(true).columns(["Item", "Qty", "Total"], widths).bold(false);
  t.rule();
  for (const l of bill.lines) t.columns(lineCells(l, ctx.unitOf(l.productId), wide), widths);
  t.rule();

  if (bill.discount > 0) {
    t.pair("Subtotal", amt(bill.total + bill.discount));
    t.pair("Round-off", `-${amt(bill.discount)}`);
  }
  t.bold(true).size(1, 2).pair("TOTAL", amt(bill.total)).size(1, 1).bold(false);
  t.feed(1);

  if (bill.paymentType === "credit") {
    t.pair("Paid now", amt(bill.paid));
    t.pair("On credit", amt(bill.due));
    if (ctx.previousBalance !== undefined) {
      t.pair("Previous balance", amt(ctx.previousBalance));
      t.bold(true).pair("Total balance", amt(ctx.previousBalance + bill.due)).bold(false);
    }
  } else {
    t.pair("Cash", amt(bill.tender));
    t.pair("Change", amt(bill.change));
  }

  t.rule();
  t.align("center").line("Thank you for shopping with us").align("left");
  return t.cut();
}

/**
 * The counter copy — the slip the cutting counter works from. Bill number
 * big, then just what to prepare: item, quantity, unit.
 */
export function counterCopy(bill: Bill, ctx: ReceiptContext): Ticket {
  const cols = columnsFor(ctx.paperWidth);
  const t = new Ticket(cols);
  const widths = [cols - 10 - 5 - 11 - 3, -10, 5, -11];

  billNumber(t, bill, ctx.reprint);
  t.align("center").bold(true).line("COUNTER COPY").bold(false).align("left");
  t.line(`Customer: ${bill.customerName ?? "Walk-in"}`);
  t.line(`Date: ${stamp(bill.createdAt)}`);
  t.rule();
  t.bold(true).columns(["Item", "Qty", "Unit", "Price"], widths).bold(false);
  t.rule();
  t.size(1, 2);
  for (const l of bill.lines) {
    t.columns([l.name, qty(l.qty), ctx.unitOf(l.productId), amt(l.price * l.qty)], widths);
  }
  t.size(1, 1);
  t.rule();
  return t.cut();
}

/** Does this bill need a counter copy — any line from a counter-copy category? */
export function needsCounterCopy(
  bill: Pick<Bill, "lines">,
  products: Product[],
  categories: Category[],
): boolean {
  const flagged = new Set(categories.filter((c) => c.counterCopy).map((c) => c.id));
  const categoryOf = new Map(products.map((p) => [p.id, p.categoryId]));
  return bill.lines.some((l) => flagged.has(l.categoryId ?? categoryOf.get(l.productId) ?? ""));
}

/** Customer receipt, plus the counter copy when the bill and settings call for one. */
export function billTickets(
  bill: Bill,
  ctx: ReceiptContext & { withCounterCopy: boolean },
): Ticket[] {
  const tickets = [customerReceipt(bill, ctx)];
  if (ctx.withCounterCopy) tickets.push(counterCopy(bill, ctx));
  return tickets;
}

/** Receipt for a credit payment, as the old app printed at the counter. */
export function paymentReceipt(params: {
  paperWidth: 58 | 80;
  customerName: string;
  amount: number;
  balanceBefore: number;
  /** Defaults to now — a slip is printed the moment the money is taken. */
  createdAt?: number;
}): Ticket {
  const t = new Ticket(columnsFor(params.paperWidth));
  letterhead(t);
  t.align("center").bold(true).line("CREDIT PAYMENT RECEIPT").bold(false).align("left");
  t.line(`Customer: ${params.customerName}`);
  t.line(`Date: ${stamp(params.createdAt ?? Date.now())}`);
  t.rule();
  t.pair("Balance before", amt(params.balanceBefore));
  t.bold(true).size(1, 2).pair("PAYMENT", amt(params.amount)).size(1, 1).bold(false);
  t.pair("Balance now", amt(Math.max(0, params.balanceBefore - params.amount)));
  t.rule();
  t.align("center").line("Thank you for your payment").align("left");
  return t.cut();
}

export function testTicket(paperWidth: 58 | 80): Ticket {
  const t = new Ticket(columnsFor(paperWidth));
  letterhead(t);
  t.align("center").bold(true).line("PRINTER TEST").bold(false);
  t.line(stamp(Date.now()));
  t.rule("=");
  t.align("left").pair("Paper", `${paperWidth} mm`).pair("Characters per line", String(t.cols));
  t.rule("=");
  t.align("center").line("The printer is working.");
  return t.cut();
}
