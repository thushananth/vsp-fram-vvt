import type { Bill, Category, CreditPayment, Customer, Order, Product } from "@/lib/types";
import { TooManyRowsError, type DataSource, type MsRange, type StaffMember, type StoreFacts } from "./types";

/** Most documents one question may read from Firestore (each is a billed read). */
export const READ_BUDGET = 3000;

/**
 * Wraps a DataSource with a per-question read budget and a per-chat cache.
 * A follow-up question about the same week reuses what was read, at no cost.
 * Cleared with the chat, so a new chat reads fresh data.
 */
export class Reader {
  private cache = new Map<string, Promise<unknown>>();
  private spent = 0;

  constructor(private source: DataSource, private budget = READ_BUDGET) {}

  /** Call before each question: the budget is per question, the cache per chat. */
  beginQuestion(): void {
    this.spent = 0;
  }

  get documentsRead(): number {
    return this.spent;
  }

  clear(): void {
    this.cache.clear();
    this.spent = 0;
  }

  /** Uncached reads run one after another, so each sees what the last one spent. */
  private queue: Promise<unknown> = Promise.resolve();

  private load<T extends unknown[]>(key: string, what: string, fetch: (max: number) => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit) return hit as Promise<T>;
    // The model often asks for several tools at once. Started together, every
    // read would see the whole budget and one question could read it twice.
    const p = this.queue
      .catch(() => undefined)
      .then(async () => {
        const left = this.budget - this.spent;
        if (left <= 0) throw new TooManyRowsError(what);
        const rows = await fetch(left);
        if (rows.length > left) throw new TooManyRowsError(what);
        this.spent += rows.length;
        return rows;
      });
    this.queue = p;
    // A failed read is not cached, so the next question can try again.
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    return p;
  }

  bills(r: MsRange): Promise<Bill[]> {
    return this.load(`bills:${r.startMs}-${r.endMs}`, "bills", (max) => this.source.bills(r, max));
  }
  billsForCustomer(id: string): Promise<Bill[]> {
    return this.load(`bills:customer:${id}`, "this customer's bills", (max) => this.source.billsForCustomer(id, max));
  }
  creditPayments(r: MsRange): Promise<CreditPayment[]> {
    return this.load(`payments:${r.startMs}-${r.endMs}`, "payments", (max) => this.source.creditPayments(r, max));
  }
  paymentsForCustomer(id: string): Promise<CreditPayment[]> {
    return this.load(`payments:customer:${id}`, "this customer's payments", (max) =>
      this.source.paymentsForCustomer(id, max),
    );
  }
  orders(from: string, to: string): Promise<Order[]> {
    return this.load(`orders:${from}-${to}`, "orders", (max) => this.source.orders(from, to, max));
  }
  customers(): Promise<Customer[]> {
    return this.load("customers", "customers", (max) => this.source.customers(max));
  }
  products(): Promise<Product[]> {
    return this.load("products", "products", (max) => this.source.products(max));
  }
  categories(): Promise<Category[]> {
    return this.load("categories", "categories", (max) => this.source.categories(max));
  }
  users(): Promise<StaffMember[]> {
    return this.load("users", "staff", (max) => this.source.users(max));
  }
  async storeFacts(): Promise<StoreFacts> {
    const [facts] = await this.load("settings", "settings", async () => [await this.source.storeFacts()]);
    return facts;
  }
}
