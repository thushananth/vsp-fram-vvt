export interface Category {
  id: string;
  name: string;
  /** Default unit for products created in it — "kg" for chicken, "pcs" for eggs. */
  unit: string;
  /** Print a second, kitchen-side ticket when a bill has anything from here
   *  (the old app did this for chicken, so the cutting counter gets a slip). */
  counterCopy: boolean;
  /** Accent for chips and tiles. One of CATEGORY_COLORS. */
  color: string;
  sortOrder: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  /** What we paid for it. Admin-only — margin comes from price - costPrice. */
  costPrice: number;
  /** "kg", "pcs"… printed beside the quantity on the receipt. */
  unit: string;
  categoryId: string;
  /** Denormalised category name, so bills and reports need no join. */
  category: string;
  barcode: string | null;
  active: boolean;
  sortOrder: number;
  imageUrl: string | null;
}

export interface BillLine {
  productId: string;
  name: string;
  /** The product's category when it was sold, so a later move to another
   *  category doesn't rewrite past reports. Absent on early bills. */
  categoryId?: string;
  qty: number;
  /** What was actually charged — the cashier may have overridden it. */
  price: number;
  /**
   * The product's own price at the time, recorded only when `price` differs
   * from it. Absent on every line sold at list price, so an override stands
   * out in the bill history.
   */
  listPrice?: number;
  /**
   * What the shop paid for one unit, stamped at the moment of sale. Profit has
   * to be measured against the cost that applied *then* — reading it back off
   * the product would re-price last month's margin every time cost changes.
   * Absent on bills written before this existed.
   */
  costPrice?: number;
}

export interface Bill {
  id: string;
  no: number;
  createdAt: number;
  cashierId: string;
  lines: BillLine[];
  total: number;
  tender: number;
  change: number;
  status: "paid" | "void";
  synced: boolean;
  /** null on a walk-in cash sale — we keep no placeholder customer. */
  customerId: string | null;
  /** Denormalised so the bills list needs no join. */
  customerName: string | null;
  paymentType: PaymentType;
  /** Taken at the till. 0 on a full credit bill, part of the total on a
   *  short payment, the whole total on a normal cash sale. */
  paid: number;
  /** total - paid. Falls to 0 as credit payments land. */
  due: number;
  /**
   * Knocked off a walk-in's bill when they paid a little short (Settings →
   * walk-in round-off). `total` is already net of it; the lines still add up
   * to total + discount.
   */
  discount: number;
}

export type PaymentType = "cash" | "credit";

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  mobileNumber: string;
  /** Cached total owed: sum of unpaid bills + openingBalance. */
  remainingCredit: number;
  /** Debt carried in from the Flutter app, with no bill behind it here. */
  openingBalance: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CustomerType = "shop" | "person";

/** One line of a payment: which bill it cleared, and by how much. */
export interface CreditAllocation {
  /** null means the share that went against the customer's opening balance. */
  billId: string | null;
  billNo: number | null;
  amount: number;
}

export interface CreditPayment {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: "cash";
  allocations: CreditAllocation[];
  receivedBy: string;
  createdAt: number;
  note: string | null;
}

export type Role = "cashier" | "admin";
