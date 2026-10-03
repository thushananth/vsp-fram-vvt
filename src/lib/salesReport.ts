import { localDateKey } from "@/lib/format";
import { lineAmount } from "@/lib/billLines";
import type { Bill, Category, CreditPayment, Customer, Product } from "@/lib/types";

/**
 * Every figure on the Sales report and its PDFs, worked out once. Mirrors the
 * old app's reports: totals split cash / credit, cash received from debtors,
 * summary by category and by product, the same by day, and who still owes.
 * Cash vs credit follows the bill, as the old app did — a part-paid credit
 * bill counts as a credit sale.
 */

const UNCATEGORISED = { id: "", name: "Other", color: "#94a3b8" };

export interface SalesTotals {
  /** What was charged — net of walk-in round-off. */
  net: number;
  cash: number;
  credit: number;
  roundOff: number;
  /** Price-overrides at the till: list price minus what was charged. */
  priceDiscount: number;
  voided: number;
  bills: number;
  voidBills: number;
  /** Credit payments received in the range. */
  received: number;
  /** Cash actually taken in: paid on bills plus payments received. */
  cashIn: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  cash: number;
  credit: number;
  total: number;
}

export interface ProductRow {
  key: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  cashQty: number;
  creditQty: number;
  cash: number;
  credit: number;
  total: number;
  discount: number;
}

export interface DayRow {
  day: string;
  bills: number;
  cash: number;
  credit: number;
  roundOff: number;
  total: number;
  received: number;
}

export interface DayBreakdown {
  day: string;
  rows: { name: string; qty: number; unit: string; total: number }[];
}

export interface OutstandingRow {
  customerId: string;
  name: string;
  mobile: string;
  balance: number;
  lastPaymentAt: number | null;
  lastPaymentAmount: number | null;
}

export interface SalesReport {
  startMs: number;
  endMs: number;
  bills: Bill[];
  voidBills: Bill[];
  payments: CreditPayment[];
  totals: SalesTotals;
  byCategory: CategoryRow[];
  byProduct: ProductRow[];
  byDay: DayRow[];
  byDayCategory: DayBreakdown[];
  byDayProduct: DayBreakdown[];
  outstanding: OutstandingRow[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildSalesReport(params: {
  bills: Bill[];
  payments: CreditPayment[];
  customers: Customer[];
  products: Product[];
  categories: Category[];
  startMs: number;
  endMs: number;
}): SalesReport {
  const { startMs, endMs } = params;
  const inRange = (ms: number) => ms >= startMs && ms < endMs;
  const productById = new Map(params.products.map((p) => [p.id, p]));
  const categoryById = new Map(params.categories.map((c) => [c.id, c]));
  const categoryOf = (productId: string, stamped?: string) => {
    const p = productById.get(productId);
    const c = categoryById.get(stamped ?? p?.categoryId ?? "");
    return c ?? (p?.category ? { id: p.categoryId, name: p.category, color: UNCATEGORISED.color } : UNCATEGORISED);
  };

  const all = params.bills.filter((b) => inRange(b.createdAt)).sort((a, b) => a.createdAt - b.createdAt);
  const bills = all.filter((b) => b.status !== "void");
  const voidBills = all.filter((b) => b.status === "void");
  // Spending held advance is not money coming in — the cash was counted when
  // it was paid.
  const payments = params.payments.filter((p) => p.method !== "advance" && inRange(p.createdAt)).sort((a, b) => a.createdAt - b.createdAt);

  const totals: SalesTotals = {
    net: 0,
    cash: 0,
    credit: 0,
    roundOff: 0,
    priceDiscount: 0,
    voided: r2(voidBills.reduce((s, b) => s + b.total, 0)),
    bills: bills.length,
    voidBills: voidBills.length,
    received: r2(payments.reduce((s, p) => s + p.amount, 0)),
    cashIn: 0,
  };

  const cats = new Map<string, CategoryRow>();
  const prods = new Map<string, ProductRow>();
  const days = new Map<string, DayRow>();
  const dayCats = new Map<string, Map<string, { name: string; qty: number; unit: string; total: number }>>();
  const dayProds = new Map<string, Map<string, { name: string; qty: number; unit: string; total: number }>>();

  const dayRow = (day: string) => {
    let row = days.get(day);
    if (!row) {
      row = { day, bills: 0, cash: 0, credit: 0, roundOff: 0, total: 0, received: 0 };
      days.set(day, row);
    }
    return row;
  };
  const bump = (
    map: Map<string, Map<string, { name: string; qty: number; unit: string; total: number }>>,
    day: string,
    key: string,
    name: string,
    unit: string,
    qty: number,
    total: number,
  ) => {
    const inner = map.get(day) ?? new Map();
    const cur = inner.get(key) ?? { name, qty: 0, unit, total: 0 };
    cur.qty += qty;
    cur.total += total;
    inner.set(key, cur);
    map.set(day, inner);
  };

  for (const b of bills) {
    const credit = b.paymentType === "credit";
    totals.net += b.total;
    totals.roundOff += b.discount;
    totals.cashIn += b.paid;
    if (credit) totals.credit += b.total;
    else totals.cash += b.total;

    const day = localDateKey(b.createdAt);
    const d = dayRow(day);
    d.bills += 1;
    d.total += b.total;
    d.roundOff += b.discount;
    if (credit) d.credit += b.total;
    else d.cash += b.total;

    for (const l of b.lines) {
      const amount = lineAmount(l);
      const cat = categoryOf(l.productId, l.categoryId);
      const unit = productById.get(l.productId)?.unit ?? "";
      const discount = l.listPrice !== undefined ? Math.max(0, (l.listPrice - l.price) * l.qty) : 0;
      totals.priceDiscount += discount;

      const c = cats.get(cat.id) ?? { id: cat.id, name: cat.name, color: cat.color, cash: 0, credit: 0, total: 0 };
      c.total += amount;
      if (credit) c.credit += amount;
      else c.cash += amount;
      cats.set(cat.id, c);

      // Keyed on product *and* name: migrated lines have no live product.
      const key = `${l.productId}|${l.name}`;
      const p = prods.get(key) ?? {
        key,
        name: l.name,
        category: cat.name,
        unit,
        qty: 0,
        cashQty: 0,
        creditQty: 0,
        cash: 0,
        credit: 0,
        total: 0,
        discount: 0,
      };
      p.qty += l.qty;
      p.total += amount;
      p.discount += discount;
      if (credit) {
        p.credit += amount;
        p.creditQty += l.qty;
      } else {
        p.cash += amount;
        p.cashQty += l.qty;
      }
      prods.set(key, p);

      bump(dayCats, day, cat.id, cat.name, "", l.qty, amount);
      bump(dayProds, day, key, l.name, unit, l.qty, amount);
    }
  }
  for (const p of payments) dayRow(localDateKey(p.createdAt)).received += p.amount;
  totals.cashIn += totals.received;

  // Last payment per customer, across all time — the outstanding list is a
  // snapshot of today, not bound to the range.
  const lastPay = new Map<string, CreditPayment>();
  for (const p of params.payments) {
    if (p.method === "advance") continue;
    const cur = lastPay.get(p.customerId);
    if (!cur || p.createdAt > cur.createdAt) lastPay.set(p.customerId, p);
  }
  const outstanding: OutstandingRow[] = params.customers
    .filter((c) => c.remainingCredit > 0.004)
    .map((c) => ({
      customerId: c.id,
      name: c.name,
      mobile: c.mobileNumber,
      balance: c.remainingCredit,
      lastPaymentAt: lastPay.get(c.id)?.createdAt ?? null,
      lastPaymentAmount: lastPay.get(c.id)?.amount ?? null,
    }))
    .sort((a, b) => b.balance - a.balance);

  const round = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? (k.toLowerCase().includes("qty") ? r3(v) : r2(v)) : v])) as T;

  const breakdown = (map: typeof dayCats): DayBreakdown[] =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, inner]) => ({
        day,
        rows: [...inner.values()].map((r) => ({ ...r, qty: r3(r.qty), total: r2(r.total) })).sort((a, b) => b.total - a.total),
      }));

  return {
    startMs,
    endMs,
    bills,
    voidBills,
    payments,
    totals: round(totals),
    byCategory: [...cats.values()].map(round).sort((a, b) => b.total - a.total),
    byProduct: [...prods.values()].map(round).sort((a, b) => b.total - a.total),
    byDay: [...days.values()].map(round).sort((a, b) => a.day.localeCompare(b.day)),
    byDayCategory: breakdown(dayCats),
    byDayProduct: breakdown(dayProds),
    outstanding,
  };
}
