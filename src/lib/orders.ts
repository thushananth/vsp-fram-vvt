import type { Bill, Order, OrderLine, OrderStatus } from "@/lib/types";
import { localDateKey } from "@/lib/format";

/** 43 → "OR-0043". Keep in step with orderLabel in functions/src/orders.ts. */
export function orderLabel(no: number): string {
  return `OR-${String(no).padStart(4, "0")}`;
}

/**
 * How a bill's number is printed everywhere: "OR-0043" on a bill that came
 * from an advance order, "#1234" on every till bill — unchanged.
 */
export function billLabel(bill: { no: number; kind?: "order" }): string {
  return bill.kind === "order" ? orderLabel(bill.no) : `#${bill.no}`;
}

/** A payment allocation's bill, as printed: "OR-0043", "#12", or "Opening". */
export function allocationLabel(a: { billNo: number | null; billKind?: "order" }, opening = "Opening"): string {
  if (!a.billNo) return opening;
  return a.billKind === "order" ? orderLabel(a.billNo) : `#${a.billNo}`;
}

/** Does a typed search ("43", "#43", "or-43", "OR-0043") name this bill? */
export function billMatches(bill: { no: number; kind?: "order" }, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  if (String(bill.no).includes(n.replace(/^#/, ""))) return true;
  if (bill.kind !== "order") return false;
  const digits = n.replace(/^or-?/, "");
  return digits !== n && digits !== "" && String(bill.no) === String(Number(digits));
}

/**
 * Does a typed search name this order? Its number ("43", "OR-0043"), the
 * customer (as stored or as shown), a product on it, or its note.
 */
export function orderMatches(
  order: Pick<Order, "orderNo" | "customerName" | "lines" | "notes">,
  needle: string,
  shownName?: string,
): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  if (billMatches({ no: order.orderNo, kind: "order" }, n)) return true;
  if (orderLabel(order.orderNo).toLowerCase().includes(n)) return true;
  if (order.customerName.toLowerCase().includes(n)) return true;
  if (shownName && shownName.toLowerCase().includes(n)) return true;
  if (order.notes && order.notes.toLowerCase().includes(n)) return true;
  return order.lines.some((l) => l.name.toLowerCase().includes(n));
}

/** The id the OR- bill gets each time the order goes out — fixed, so a double tap writes the same bill. */
export function nextBillId(order: Pick<Order, "id" | "sendSeq">): string {
  return `${order.id}-${order.sendSeq}`;
}

/** The pseudo product the delivery charge is billed as. */
export const DELIVERY_PRODUCT_ID = "delivery";
export const DELIVERY_LINE_NAME = "Delivery charge";

/** What the Order reports screen (and its PDF) shows for the picked range and filters. */
export interface OrderReport {
  label: string;
  orders: Order[];
  counts: Record<OrderStatus, number>;
  billDeleted: number;
  value: number;
  deliveryCharges: number;
  byProduct: { name: string; unit: string; qty: number; value: number; orders: number }[];
  byCustomer: { name: string; orders: number; value: number }[];
}

// ── Dates: "yyyy-mm-dd" calendar days, the till's own (Sri Lanka) time ──

export function dateKeyAdd(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d + days).getTime());
}

export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Wed 18 Nov" — the same shape the SMS uses. */
export function shortDate(key: string): string {
  return dateFromKey(key)
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
}

/** "Wednesday 18 November" */
export function longDate(key: string): string {
  return dateFromKey(key).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "Today", "Tomorrow", or the short date. */
export function relativeDay(key: string, today: string = localDateKey()): string {
  if (key === today) return "Today";
  if (key === dateKeyAdd(today, 1)) return "Tomorrow";
  if (key === dateKeyAdd(today, -1)) return "Yesterday";
  return shortDate(key);
}

/** First and one-past-last day of the month holding `key`. */
export function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  return {
    from: localDateKey(new Date(y, m - 1, 1).getTime()),
    to: localDateKey(new Date(y, m, 0).getTime()),
  };
}

// ── Display ─────────────────────────────────────────────────────────────

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  confirmed: "Confirmed",
  out: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Tailwind classes per status, from the shared colour tokens. */
export const ORDER_STATUS_TONE: Record<OrderStatus, { pill: string; dot: string }> = {
  confirmed: { pill: "bg-accent/10 text-accent", dot: "bg-accent" },
  out: { pill: "bg-warning/10 text-warning", dot: "bg-warning" },
  delivered: { pill: "bg-success/10 text-success", dot: "bg-success" },
  cancelled: { pill: "bg-muted/15 text-muted", dot: "bg-muted-2" },
};

export function qtyText(qty: number, unit: string): string {
  return `${Math.round(qty * 1000) / 1000} ${unit}`.trim();
}

/** "Broiler 25 kg, Eggs 60 pcs" */
export function linesSummary(lines: Pick<OrderLine, "name" | "qty" | "unit">[]): string {
  return lines.map((l) => `${l.name} ${qtyText(l.qty, l.unit)}`).join(", ");
}

/** Booked prices × qty + delivery charge — an estimate only, shown in the app. */
export function estimatedTotal(order: Pick<Order, "lines" | "deliveryCharge">): number {
  const goods = order.lines.reduce((s, l) => s + l.qty * l.price, 0);
  return Math.round((goods + (order.deliveryCharge ?? 0)) * 100) / 100;
}

/** Its OR- bill was deleted on Bills: the order is closed for good and nothing can be done with it. */
export function isClosed(order: Pick<Order, "billVoided">): boolean {
  return order.billVoided;
}

/** The pill an order wears: its status, or "Closed" once its bill was deleted. */
export function orderPill(order: Pick<Order, "status" | "billVoided">): { label: string; pill: string; dot: string } {
  if (order.billVoided) return { label: "Closed · bill deleted", pill: "bg-danger/10 text-danger", dot: "bg-danger" };
  return { label: ORDER_STATUS_LABEL[order.status], ...ORDER_STATUS_TONE[order.status] };
}

/** A deleted OR- bill shows as void, never as the order's. */
export function isOrderBill(b: Pick<Bill, "kind">): boolean {
  return b.kind === "order";
}
