export interface Product {
  id: string;
  name: string;
  price: number;
  lastPrice: number;
  /** What we paid for it. Admin-only — margin comes from price - costPrice. */
  costPrice: number;
  /** "pieces", "kg"… carried over from the Flutter app's stock items. */
  unit: string;
  category: string;
  barcode: string | null;
  isBakery: boolean;
  expiryDate: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  active: boolean;
  onShelf?: number;
  /**
   * Product photo. Named to match the Flutter app's `stocks.imageUrl` so the
   * migration can copy the URL straight across.
   */
  imageUrl: string | null;
}

export interface BillLine {
  productId: string;
  name: string;
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

export interface ReturnEntry {
  id: string;
  date: string;
  productId: string;
  qty: number;
  reason: "Unsold" | "Damaged" | "Stale";
  byUserId: string;
  createdAt: number;
}

export type Role = "cashier" | "admin";

export interface BakeryDayItem {
  productId: string;
  name: string;
  received: number;
  sold: number;
  returned: number;
}
