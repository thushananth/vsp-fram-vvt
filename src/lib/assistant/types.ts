import type { Bill, Category, CreditPayment, Customer, Order, Product, Role } from "@/lib/types";

/** A staff member as the assistant may see them: no email, no devices. */
export interface StaffMember {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

/** The only store settings the assistant reads. Mobiles and emails stay out. */
export interface StoreFacts {
  walkInRoundOff: number;
}

/** From startMs up to (not including) endMs, local midnight to local midnight. */
export interface MsRange {
  startMs: number;
  endMs: number;
}

/**
 * Everything the assistant can read, already parsed into the app's own types.
 * The Firestore version is `source.ts`; tests and the fake model use an
 * in-memory one. `maxDocs` is what is left of the question's read budget: a
 * source must refuse (throw `TooManyRowsError`) rather than read past it.
 */
export interface DataSource {
  bills(range: MsRange, maxDocs: number): Promise<Bill[]>;
  billsForCustomer(customerId: string, maxDocs: number): Promise<Bill[]>;
  creditPayments(range: MsRange, maxDocs: number): Promise<CreditPayment[]>;
  paymentsForCustomer(customerId: string, maxDocs: number): Promise<CreditPayment[]>;
  /** By delivery day, inclusive "yyyy-mm-dd" keys. */
  orders(from: string, to: string, maxDocs: number): Promise<Order[]>;
  customers(maxDocs: number): Promise<Customer[]>;
  products(maxDocs: number): Promise<Product[]>;
  categories(maxDocs: number): Promise<Category[]>;
  users(maxDocs: number): Promise<StaffMember[]>;
  storeFacts(): Promise<StoreFacts>;
}

export class TooManyRowsError extends Error {
  constructor(what: string) {
    super(
      `Reading ${what} would go past the limit of records one question may read. Answer with what you already have, or tell the owner the question needs a shorter period.`,
    );
    this.name = "TooManyRowsError";
  }
}

/** A refusal the model can act on: wrong field, range too long, unknown code… */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** One row as it goes to the model: plain values, names already swapped for codes. */
export type Row = Record<string, unknown>;
