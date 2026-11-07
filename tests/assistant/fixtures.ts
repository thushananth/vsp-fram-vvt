import { toBill } from "../../src/lib/assistant/convert";
import type { DataSource, StaffMember } from "../../src/lib/assistant/types";
import { TooManyRowsError } from "../../src/lib/assistant/types";
import type { Bill, BillLine, Category, CreditPayment, Customer, Order, Product } from "../../src/lib/types";

/** Local time on a Sri Lanka day (tests run with TZ=Asia/Colombo). */
export const at = (day: string, time: string) => new Date(`${day}T${time}:00`).getTime();

export const DAY = "2026-11-07";

export const categories: Category[] = [
  { id: "cat-chicken", name: "Chicken", unit: "kg", counterCopy: true, color: "#f00", sortOrder: 0, active: true },
  { id: "cat-eggs", name: "Eggs", unit: "pcs", counterCopy: false, color: "#0f0", sortOrder: 1, active: true },
];

export const products: Product[] = [
  { id: "p-broiler", name: "Broiler", price: 950, costPrice: 780, unit: "kg", categoryId: "cat-chicken", category: "Chicken", barcode: null, active: true, sortOrder: 0, imageUrl: null },
  { id: "p-wings", name: "Wings", price: 700, costPrice: 520, unit: "kg", categoryId: "cat-chicken", category: "Chicken", barcode: null, active: true, sortOrder: 1, imageUrl: null },
  { id: "p-egg", name: "Egg", price: 50, costPrice: 38, unit: "pcs", categoryId: "cat-eggs", category: "Eggs", barcode: null, active: true, sortOrder: 2, imageUrl: null },
];

export const users: StaffMember[] = [
  { id: "uid-karthi", name: "Karthi", role: "cashier", active: true },
  { id: "uid-ramesh", name: "Ramesh Kumar", role: "cashier", active: true },
  { id: "uid-admin", name: "Owner", role: "admin", active: true },
];

export const customers: Customer[] = [
  { id: "cust-kumar", name: "Kumar Stores", type: "shop", mobileNumber: "0771234567", remainingCredit: 84200, openingBalance: 10000, advance: 0, lastReminderAt: 0, autoNamed: false, active: true, createdAt: at("2026-01-01", "09:00"), updatedAt: 0 },
  { id: "cust-nimal", name: "Nimal Hotel", type: "shop", mobileNumber: "0719876543", remainingCredit: 61750, openingBalance: 0, advance: 500, lastReminderAt: 0, autoNamed: false, active: true, createdAt: at("2026-02-01", "09:00"), updatedAt: 0 },
  { id: "cust-auto", name: "0765550000", type: "person", mobileNumber: "0765550000", remainingCredit: 0, openingBalance: 0, advance: 0, lastReminderAt: 0, autoNamed: true, active: true, createdAt: at("2026-03-01", "09:00"), updatedAt: 0 },
];

const line = (productId: string, qty: number, price: number, extra: Partial<BillLine> = {}): BillLine => {
  const p = products.find((x) => x.id === productId)!;
  return { productId, name: p.name, categoryId: p.categoryId, qty, price, costPrice: p.costPrice, ...extra };
};

let seq = 1000;
type BillInput = Partial<Bill> & { at: number; lines: BillLine[] };
export function bill(input: BillInput): Bill {
  const total = input.total ?? Math.round(input.lines.reduce((s, l) => s + (l.amount ?? l.price * l.qty), 0) * 100) / 100;
  const no = input.no ?? ++seq;
  return {
    id: input.id ?? `bill-${no}`,
    no,
    createdAt: input.at,
    cashierId: input.cashierId ?? "uid-karthi",
    lines: input.lines,
    total,
    tender: input.tender ?? 0,
    change: input.change ?? 0,
    status: input.status ?? "paid",
    synced: true,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    paymentType: input.paymentType ?? "cash",
    paid: input.paid ?? total,
    due: input.due ?? 0,
    discount: input.discount ?? 0,
    advanceUsed: input.advanceUsed ?? 0,
    ...(input.kind ? { kind: input.kind, orderId: input.orderId ?? "order-1" } : {}),
  };
}

/** A day at the till for Karthi, with a few planted reasons for a Rs 2,500 gap. */
export function karthiDay(): Bill[] {
  seq = 1000;
  return [
    // Ordinary sales.
    bill({ at: at(DAY, "08:05"), lines: [line("p-broiler", 2, 950)] }), // 1900
    bill({ at: at(DAY, "08:30"), lines: [line("p-egg", 10, 50)] }), // 500
    // Exactly the short amount, cash.
    bill({ no: 1042, at: at(DAY, "09:15"), lines: [line("p-wings", 2.5, 700, { amount: 1750 }), line("p-egg", 15, 50)] }), // 2500
    // A pair that adds up to it.
    bill({ no: 1051, at: at(DAY, "10:03"), lines: [line("p-egg", 24, 50)] }), // 1200
    bill({ no: 1057, at: at(DAY, "10:31"), lines: [line("p-egg", 26, 50)] }), // 1300
    // Change given that doesn't fit the tender: should be 1,750, gave 4,250.
    bill({ no: 1060, at: at(DAY, "11:42"), lines: [line("p-broiler", 3.421, 950, { amount: 3250 })], tender: 5000, change: 4250 }),
    // Credit bill for Kumar Stores, part-paid at the till.
    bill({ no: 1065, at: at(DAY, "12:10"), lines: [line("p-broiler", 10, 950)], customerId: "cust-kumar", customerName: "Kumar Stores", paymentType: "credit", paid: 3000, due: 6500 }),
    // Price override.
    bill({ no: 1070, at: at(DAY, "13:00"), lines: [line("p-broiler", 1, 900, { listPrice: 950 })] }),
    // Voided after cash was taken.
    bill({ no: 1033, at: at(DAY, "08:20"), lines: [line("p-broiler", 2.61, 950, { amount: 2480 })], status: "void" }),
    // Someone else's bill the same day.
    bill({ no: 1080, at: at(DAY, "14:00"), cashierId: "uid-ramesh", lines: [line("p-broiler", 5, 950)] }),
    // An advance-order bill.
    bill({ no: 43, kind: "order", at: at(DAY, "15:00"), lines: [line("p-broiler", 4, 950)], customerId: "cust-nimal", customerName: "Nimal Hotel", paymentType: "credit", paid: 0, due: 3800 }),
    // Walk-in with round-off.
    bill({ no: 1090, at: at(DAY, "16:00"), lines: [line("p-egg", 7, 50)], total: 340, paid: 340, discount: 10 }),
    // A bill from before credit existed: raw Firestore data with no paid/paymentType.
    toBill("bill-legacy", { no: 900, cashierId: "uid-karthi", lines: [line("p-wings", 1, 700)], total: 700, tender: 0, change: 0, status: "paid" }, at(DAY, "17:00")),
  ];
}

export function karthiPayments(): CreditPayment[] {
  return [
    { id: "pay-1", customerId: "cust-kumar", customerName: "Kumar Stores", amount: 5000, method: "cash", allocations: [{ billId: "bill-1065", billNo: 1065, amount: 5000 }], advance: 0, imported: false, receivedBy: "uid-karthi", createdAt: at(DAY, "17:30"), note: "paid by son 0771234567" },
    { id: "pay-2", customerId: "cust-nimal", customerName: "Nimal Hotel", amount: 1500, method: "cash", allocations: [], advance: 0, imported: false, receivedBy: "uid-karthi", createdAt: at(DAY, "18:00"), note: null },
    { id: "pay-3", customerId: "cust-nimal", customerName: "Nimal Hotel", amount: 500, method: "advance", allocations: [], advance: 0, imported: false, receivedBy: "uid-karthi", createdAt: at(DAY, "18:10"), note: null },
    { id: "pay-4", customerId: "cust-kumar", customerName: "Kumar Stores", amount: 900, method: "cash", allocations: [], advance: 0, imported: false, receivedBy: "uid-ramesh", createdAt: at(DAY, "18:20"), note: null },
  ];
}

export const orders: Order[] = [
  {
    id: "order-1", orderNo: 43, customerId: "cust-nimal", customerName: "Nimal Hotel", deliveryDate: "2026-11-08",
    lines: [{ productId: "p-broiler", name: "Broiler", unit: "kg", qty: 12, price: 950 }], deliveryCharge: 300,
    notes: "Call Nimal on 0719876543", status: "confirmed", sendSeq: 1, billId: null, billVoided: false, billVoidedAt: null, trackToken: "secret-token-xyz",
    createdAt: at("2026-11-05", "10:00"), createdBy: "uid-admin", createdByName: "Owner", outAt: null, outBy: null,
    deliveredAt: null, deliveredBy: null, cancelledAt: null, updatedAt: 0,
  },
];

/** An in-memory DataSource that counts reads the way Firestore bills them. */
export function memorySource(data: { bills: Bill[]; payments: CreditPayment[] }): DataSource & { reads: number } {
  const src = {
    reads: 0,
    take<T>(rows: T[], max: number, what: string): T[] {
      if (rows.length > max) throw new TooManyRowsError(what);
      src.reads += rows.length;
      return rows;
    },
    async bills(r: { startMs: number; endMs: number }, max: number) {
      return src.take(data.bills.filter((b) => b.createdAt >= r.startMs && b.createdAt < r.endMs), max, "bills");
    },
    async billsForCustomer(id: string, max: number) {
      return src.take(data.bills.filter((b) => b.customerId === id), max, "bills");
    },
    async creditPayments(r: { startMs: number; endMs: number }, max: number) {
      return src.take(data.payments.filter((p) => p.createdAt >= r.startMs && p.createdAt < r.endMs), max, "payments");
    },
    async paymentsForCustomer(id: string, max: number) {
      return src.take(data.payments.filter((p) => p.customerId === id), max, "payments");
    },
    async orders(from: string, to: string, max: number) {
      return src.take(orders.filter((o) => o.deliveryDate >= from && o.deliveryDate <= to), max, "orders");
    },
    async customers(max: number) {
      return src.take(customers, max, "customers");
    },
    async products(max: number) {
      return src.take(products, max, "products");
    },
    async categories(max: number) {
      return src.take(categories, max, "categories");
    },
    async users(max: number) {
      return src.take(users, max, "users");
    },
    async storeFacts() {
      return { walkInRoundOff: 20 };
    },
  };
  return src;
}
