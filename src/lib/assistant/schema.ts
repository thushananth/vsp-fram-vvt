import { lineAmount, round2, round3 } from "@/lib/billLines";
import { localDateKey } from "@/lib/format";
import { allocationLabel, billLabel, orderLabel } from "@/lib/orders";
import type { Bill, Category, CreditPayment, Customer, Order, Product } from "@/lib/types";
import { stamp } from "./dates";
import type { Masker } from "./mask";
import type { Row, StaffMember, StoreFacts } from "./types";

/**
 * What the model may read, collection by collection, and how each document is
 * turned into a row for it. Anything not listed here does not exist as far as
 * the assistant is concerned: device approvals and codes, order tracking and
 * digests, SMS campaigns, order logs, mobile numbers, emails, track tokens,
 * notes and document ids.
 */

export type FieldType = "number" | "string" | "boolean" | "date" | "person";

export interface FieldSpec {
  type: FieldType;
  /** Allowed values, listed in the tool description so the model spells them right. */
  values?: readonly string[];
  about?: string;
}

export const COLLECTIONS = [
  "bills",
  "creditPayments",
  "orders",
  "customers",
  "products",
  "categories",
  "users",
  "settings",
] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

/** How a collection must be bounded before it is read. */
export type RangeRule = "createdAt" | "deliveryDate" | null;

export const RANGE_RULE: Record<CollectionName, RangeRule> = {
  bills: "createdAt",
  creditPayments: "createdAt",
  orders: "deliveryDate",
  customers: null,
  products: null,
  categories: null,
  users: null,
  settings: null,
};

const LINE_FIELDS: Record<string, FieldSpec> = {
  product: { type: "string", about: "product name on the line" },
  category: { type: "string" },
  qty: { type: "number", about: "kg to 3 decimals, or pieces" },
  unit: { type: "string" },
  price: { type: "number", about: "price charged per unit" },
  listPrice: { type: "number", about: "list price, only when the cashier changed the price" },
  costPrice: { type: "number", about: "cost per unit stamped at sale (admin only)" },
  amount: { type: "number", about: "what the line charged" },
};

export const FIELDS: Record<CollectionName, Record<string, FieldSpec>> = {
  bills: {
    bill: { type: "string", about: '"#1042" for a till bill, "OR-0043" for an advance-order bill' },
    createdAt: { type: "date" },
    day: { type: "string", about: "yyyy-mm-dd" },
    hour: { type: "number", about: "0-23" },
    cashier: { type: "person", about: "U code" },
    customer: { type: "person", about: "C code, null on a walk-in sale" },
    paymentType: { type: "string", values: ["cash", "credit"] },
    status: { type: "string", values: ["paid", "void"] },
    kind: { type: "string", values: ["till", "order"] },
    total: { type: "number", about: "charged, after round-off" },
    paid: { type: "number", about: "cash taken at the till" },
    due: { type: "number", about: "still owed on this bill" },
    tender: { type: "number", about: "cash handed over" },
    change: { type: "number" },
    discount: { type: "number", about: "walk-in round-off" },
    advanceUsed: { type: "number", about: "customer advance spent on this bill" },
    priceOverride: { type: "number", about: "list price minus charged, over all lines" },
    lineCount: { type: "number" },
    products: { type: "string", about: "product names on the bill; use the contains operator" },
  },
  creditPayments: {
    createdAt: { type: "date" },
    day: { type: "string" },
    customer: { type: "person" },
    amount: { type: "number", about: "cash taken; for method advance, advance spent" },
    method: { type: "string", values: ["cash", "advance"] },
    keptAsAdvance: { type: "number" },
    imported: { type: "boolean", about: "brought over from the old app" },
    receivedBy: { type: "person", about: "U code" },
    bills: { type: "string", about: "bill numbers it paid" },
  },
  orders: {
    order: { type: "string", about: '"OR-0043"' },
    customer: { type: "person" },
    deliveryDate: { type: "string", about: "yyyy-mm-dd" },
    status: { type: "string", values: ["confirmed", "out", "delivered", "cancelled"] },
    deliveryCharge: { type: "number" },
    estimate: { type: "number", about: "booked qty × list price + delivery charge; the bill is priced on the day" },
    products: { type: "string" },
    createdAt: { type: "date" },
    createdBy: { type: "person" },
    outAt: { type: "date" },
    deliveredAt: { type: "date" },
  },
  customers: {
    customer: { type: "person" },
    type: { type: "string", values: ["shop", "person"] },
    balance: { type: "number", about: "total owed now" },
    openingBalance: { type: "number", about: "debt carried from the old app" },
    advance: { type: "number", about: "money held for the customer" },
    active: { type: "boolean" },
    createdAt: { type: "date" },
    lastReminderAt: { type: "date" },
  },
  products: {
    product: { type: "string" },
    category: { type: "string" },
    price: { type: "number" },
    costPrice: { type: "number" },
    unit: { type: "string" },
    active: { type: "boolean" },
  },
  categories: {
    category: { type: "string" },
    unit: { type: "string" },
    active: { type: "boolean" },
  },
  users: {
    user: { type: "person" },
    role: { type: "string", values: ["admin", "cashier"] },
    active: { type: "boolean" },
  },
  settings: {
    walkInRoundOff: { type: "number", about: "largest round-off allowed on a walk-in bill" },
  },
};

/** Collections whose lines can be unnested, and the extra fields that gives. */
export const LINE_COLLECTIONS: Partial<Record<CollectionName, Record<string, FieldSpec>>> = {
  bills: LINE_FIELDS,
  orders: { product: LINE_FIELDS.product, qty: LINE_FIELDS.qty, unit: LINE_FIELDS.unit, price: LINE_FIELDS.price },
};

export interface Lookups {
  masker: Masker;
  categoriesById: Map<string, Category>;
  productsById: Map<string, Product>;
  usersById: Map<string, StaffMember>;
}

function userCode(l: Lookups, id: string | null | undefined): string | null {
  if (!id) return null;
  return l.masker.code("U", id, l.usersById.get(id)?.name ?? "");
}

export function priceOverride(b: Pick<Bill, "lines">): number {
  return round2(
    b.lines.reduce((s, x) => s + (x.listPrice !== undefined ? Math.max(0, (x.listPrice - x.price) * x.qty) : 0), 0),
  );
}

export function billRow(b: Bill, l: Lookups): Row {
  const d = new Date(b.createdAt);
  return {
    bill: billLabel(b),
    createdAt: stamp(b.createdAt),
    day: localDateKey(b.createdAt),
    hour: d.getHours(),
    cashier: userCode(l, b.cashierId),
    customer: l.masker.maybe("C", b.customerId, b.customerName),
    paymentType: b.paymentType,
    status: b.status,
    kind: b.kind === "order" ? "order" : "till",
    total: b.total,
    paid: b.paid,
    due: b.due,
    tender: b.tender,
    change: b.change,
    discount: b.discount,
    advanceUsed: b.advanceUsed,
    priceOverride: priceOverride(b),
    lineCount: b.lines.length,
    products: [...new Set(b.lines.map((x) => x.name))].join(", "),
  };
}

export function billLineRows(b: Bill, l: Lookups): Row[] {
  const parent = billRow(b, l);
  delete parent.products;
  return b.lines.map((x) => {
    const product = l.productsById.get(x.productId);
    const category = l.categoriesById.get(x.categoryId ?? product?.categoryId ?? "");
    return {
      ...parent,
      product: x.name,
      category: category?.name ?? product?.category ?? "Other",
      qty: round3(x.qty),
      unit: product?.unit ?? "",
      price: x.price,
      listPrice: x.listPrice ?? null,
      costPrice: x.costPrice ?? product?.costPrice ?? null,
      amount: lineAmount(x),
    };
  });
}

export function paymentRow(p: CreditPayment, l: Lookups): Row {
  return {
    createdAt: stamp(p.createdAt),
    day: localDateKey(p.createdAt),
    customer: l.masker.maybe("C", p.customerId, p.customerName),
    amount: p.amount,
    method: p.method,
    keptAsAdvance: p.advance,
    imported: p.imported,
    receivedBy: userCode(l, p.receivedBy),
    bills: p.allocations.map((a) => allocationLabel(a)).join(", "),
  };
}

export function orderRow(o: Order, l: Lookups): Row {
  const goods = o.lines.reduce((s, x) => s + x.qty * x.price, 0);
  return {
    order: orderLabel(o.orderNo),
    customer: l.masker.maybe("C", o.customerId, o.customerName),
    deliveryDate: o.deliveryDate,
    status: o.status,
    deliveryCharge: o.deliveryCharge,
    estimate: round2(goods + o.deliveryCharge),
    products: o.lines.map((x) => `${x.name} ${round3(x.qty)} ${x.unit}`).join(", "),
    createdAt: stamp(o.createdAt),
    createdBy: o.createdBy ? l.masker.code("U", o.createdBy, o.createdByName) : null,
    outAt: o.outAt ? stamp(o.outAt) : null,
    deliveredAt: o.deliveredAt ? stamp(o.deliveredAt) : null,
  };
}

export function orderLineRows(o: Order, l: Lookups): Row[] {
  const parent = orderRow(o, l);
  delete parent.products;
  return o.lines.map((x) => ({ ...parent, product: x.name, qty: round3(x.qty), unit: x.unit, price: x.price }));
}

export function customerRow(c: Customer, l: Lookups): Row {
  return {
    customer: l.masker.code("C", c.id, c.name),
    type: c.type,
    balance: c.remainingCredit,
    openingBalance: c.openingBalance,
    advance: c.advance,
    active: c.active,
    createdAt: stamp(c.createdAt),
    lastReminderAt: c.lastReminderAt ? stamp(c.lastReminderAt) : null,
  };
}

export function productRow(p: Product): Row {
  return { product: p.name, category: p.category, price: p.price, costPrice: p.costPrice, unit: p.unit, active: p.active };
}

export function categoryRow(c: Category): Row {
  return { category: c.name, unit: c.unit, active: c.active };
}

export function userRow(u: StaffMember, l: Lookups): Row {
  return { user: l.masker.code("U", u.id, u.name), role: u.role, active: u.active };
}

export function settingsRow(s: StoreFacts): Row {
  return { walkInRoundOff: s.walkInRoundOff };
}
