import type {
  Bill,
  BillLine,
  Category,
  CreditAllocation,
  CreditPayment,
  Customer,
  Order,
  OrderLine,
  OrderStatus,
  Product,
} from "@/lib/types";
import type { StaffMember, StoreFacts } from "./types";

/**
 * Raw Firestore data into the app's types, with the same defaults as the
 * converters in src/lib/firestore/* (which can't be imported here: those
 * modules also hold the writes). Keep them in step. The defaults matter:
 * bills from before credit existed have no paid/paymentType and must read as
 * fully paid cash sales, or every cash total comes out wrong.
 *
 * Timestamps arrive already turned into epoch millis by the adapter.
 */

type Data = Record<string, unknown>;

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

export function toBill(id: string, data: Data, createdAtMs: number): Bill {
  const total = num(data.total);
  return {
    id,
    no: num(data.no),
    createdAt: createdAtMs,
    cashierId: str(data.cashierId),
    lines: (Array.isArray(data.lines) ? data.lines : []) as BillLine[],
    total,
    tender: num(data.tender),
    change: num(data.change),
    status: data.status === "void" ? "void" : "paid",
    synced: true,
    customerId: (data.customerId as string) ?? null,
    customerName: (data.customerName as string) ?? null,
    paymentType: data.paymentType === "credit" ? "credit" : "cash",
    paid: num(data.paid, total),
    due: num(data.due),
    discount: num(data.discount),
    advanceUsed: num(data.advanceUsed),
    ...(data.kind === "order" ? { kind: "order" as const, orderId: str(data.orderId) } : {}),
  };
}

export function toPayment(id: string, data: Data): CreditPayment {
  return {
    id,
    customerId: str(data.customerId),
    customerName: str(data.customerName),
    amount: num(data.amount),
    method: data.method === "advance" ? "advance" : "cash",
    allocations: (Array.isArray(data.allocations) ? data.allocations : []) as CreditAllocation[],
    advance: num(data.advance),
    imported: data.imported === true,
    receivedBy: str(data.receivedBy),
    createdAt: num(data.createdAt),
    note: null, // free text; never read by the assistant
  };
}

const STATUSES: OrderStatus[] = ["confirmed", "out", "delivered", "cancelled"];

export function toOrder(id: string, d: Data): Order {
  return {
    id,
    orderNo: num(d.orderNo),
    customerId: str(d.customerId),
    customerName: str(d.customerName),
    deliveryDate: str(d.deliveryDate),
    lines: (Array.isArray(d.lines) ? d.lines : []) as OrderLine[],
    deliveryCharge: num(d.deliveryCharge),
    notes: null, // free text; never read by the assistant
    status: STATUSES.includes(d.status as OrderStatus) ? (d.status as OrderStatus) : "confirmed",
    sendSeq: num(d.sendSeq, 1),
    billId: (d.billId as string | null) ?? null,
    billVoided: d.billVoided === true,
    billVoidedAt: numOrNull(d.billVoidedAt),
    trackToken: "", // the customer's secret link; never read by the assistant
    createdAt: num(d.createdAt),
    createdBy: str(d.createdBy),
    createdByName: str(d.createdByName),
    outAt: numOrNull(d.outAt),
    outBy: (d.outBy as string | null) ?? null,
    deliveredAt: numOrNull(d.deliveredAt),
    deliveredBy: (d.deliveredBy as string | null) ?? null,
    cancelledAt: numOrNull(d.cancelledAt),
    updatedAt: num(d.updatedAt),
  };
}

export function toCustomer(id: string, data: Data): Customer {
  return {
    id,
    name: str(data.name),
    type: data.type === "shop" ? "shop" : "person",
    mobileNumber: "", // never read by the assistant
    remainingCredit: num(data.remainingCredit),
    openingBalance: num(data.openingBalance),
    advance: num(data.advance),
    lastReminderAt: num(data.lastReminderAt),
    autoNamed: data.autoNamed === true,
    active: data.active !== false,
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
  };
}

export function toProduct(id: string, data: Data): Product {
  return {
    id,
    name: str(data.name),
    price: num(data.price),
    costPrice: num(data.costPrice),
    unit: str(data.unit, "pcs"),
    categoryId: str(data.categoryId),
    category: str(data.category),
    barcode: null,
    active: data.active !== false,
    sortOrder: num(data.sortOrder),
    imageUrl: null,
  };
}

export function toCategory(id: string, data: Data): Category {
  return {
    id,
    name: str(data.name),
    unit: str(data.unit, "pcs"),
    counterCopy: data.counterCopy === true,
    color: str(data.color),
    sortOrder: num(data.sortOrder),
    active: data.active !== false,
  };
}

export function toStaff(id: string, data: Data): StaffMember {
  return {
    id,
    // Only the name, never the email: the screen shows it, the model gets a code.
    name: str(data.name, "User") || "User",
    role: data.role === "admin" ? "admin" : "cashier",
    active: data.active !== false,
  };
}

export function toStoreFacts(data: Data | undefined): StoreFacts {
  return { walkInRoundOff: num(data?.walkInRoundOff, 20) };
}
