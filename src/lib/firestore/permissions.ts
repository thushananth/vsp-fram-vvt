"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";

/**
 * Toggleable cashier permissions, admin-editable from Permissions. Admins can
 * always do everything regardless of these flags — this only widens or
 * narrows what a *cashier* account can do. Modelled on the old app's
 * permission list (reports by scope, customers, items), regrouped.
 */
export interface CashierPermissions {
  // Billing
  /** Override a line price on the bill itself — a discount at the counter. */
  editBillPrices: boolean;
  // Bills
  voidBills: boolean;
  reprintBills: boolean;
  // Customers & credit
  addCustomers: boolean;
  editCustomers: boolean;
  viewPaymentHistory: boolean;
  // Products
  addProducts: boolean;
  editProducts: boolean;
  toggleProducts: boolean;
  manageCategories: boolean;
  // Reports
  todaySummary: boolean;
  todayDetail: boolean;
  rangeSummary: boolean;
  rangeDetail: boolean;
  customerReports: boolean;
}

export type PermissionKey = keyof CashierPermissions;

export const DEFAULT_PERMISSIONS: CashierPermissions = {
  editBillPrices: true,
  voidBills: false,
  reprintBills: true,
  addCustomers: true,
  editCustomers: false,
  viewPaymentHistory: true,
  addProducts: false,
  editProducts: false,
  toggleProducts: false,
  manageCategories: false,
  todaySummary: true,
  todayDetail: false,
  rangeSummary: false,
  rangeDetail: false,
  customerReports: false,
};

export interface PermissionGroup {
  id: string;
  title: string;
  blurb: string;
  items: { key: PermissionKey; label: string; body: string }[];
}

/** The Permissions screen's layout, and the single source of every label. */
export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "billing",
    title: "Billing",
    blurb: "At the till",
    items: [
      {
        key: "editBillPrices",
        label: "Change a price on the bill",
        body: "Give a regular a special price on one line. The product's own price is never touched.",
      },
    ],
  },
  {
    id: "bills",
    title: "Bills",
    blurb: "Past receipts",
    items: [
      { key: "reprintBills", label: "Reprint & download bills", body: "Print a past receipt again or save it as a PDF." },
      { key: "voidBills", label: "Delete bills", body: "Void a bill. Unpaid credit on it comes off the customer's balance." },
    ],
  },
  {
    id: "customers",
    title: "Customers & credit",
    blurb: "Accounts and payments",
    items: [
      { key: "addCustomers", label: "Add customers", body: "Create a new customer, including from the till." },
      { key: "editCustomers", label: "Edit customers", body: "Change a customer's name, type or mobile number." },
      { key: "viewPaymentHistory", label: "See credit payments", body: "Open the history of payments customers have made." },
    ],
  },
  {
    id: "products",
    title: "Products",
    blurb: "What the till sells",
    items: [
      { key: "addProducts", label: "Add products", body: "Create new products in any category." },
      { key: "editProducts", label: "Edit products & prices", body: "Change a product's name, price, unit or category." },
      { key: "toggleProducts", label: "Hide & show products", body: "Take a product off the till, or bring it back." },
      { key: "manageCategories", label: "Manage categories", body: "Add, rename, reorder and archive categories." },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    blurb: "Sales and statements",
    items: [
      { key: "todaySummary", label: "Today's summary", body: "Today's totals by category and product, cash and credit." },
      { key: "todayDetail", label: "Today's detail", body: "Every bill of the day, line by line." },
      { key: "rangeSummary", label: "Summary for any dates", body: "Pick any date range for the summary report." },
      { key: "rangeDetail", label: "Detail for any dates", body: "Bill-by-bill detail for any date range." },
      { key: "customerReports", label: "Customer reports", body: "Customer statements and the customers overview." },
    ],
  },
];

const PERMISSIONS_DOC = "settings/cashierPermissions";

export function usePermissions(): { permissions: CashierPermissions; loading: boolean } {
  const [permissions, setPermissions] = useState<CashierPermissions>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setPermissions(DEFAULT_PERMISSIONS);
        setLoading(false);
        if (unsubSnapshot) {
          unsubSnapshot();
          unsubSnapshot = null;
        }
        return;
      }
      unsubSnapshot = onSnapshot(
        doc(db, PERMISSIONS_DOC),
        (snap) => {
          setPermissions({ ...DEFAULT_PERMISSIONS, ...(snap.data() as Partial<CashierPermissions> | undefined) });
          setLoading(false);
        },
        () => setLoading(false),
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, []);

  return { permissions, loading };
}

export async function savePermissions(permissions: CashierPermissions) {
  await setDoc(doc(db, PERMISSIONS_DOC), permissions, { merge: true });
}

/**
 * `can("addProducts")` — true for every admin, and for a cashier when the
 * admin has switched that permission on.
 */
export function useCan(): { can: (key: PermissionKey) => boolean; loading: boolean } {
  const { profile, loading: authLoading } = useAuth();
  const { permissions, loading } = usePermissions();
  return {
    can: (key) => profile?.role === "admin" || permissions[key],
    loading: authLoading || loading,
  };
}
