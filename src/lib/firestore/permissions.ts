"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Toggleable cashier permissions, admin-editable from Settings. Admins can
 * always do everything regardless of these flags — this only widens or
 * narrows what a *cashier* account can do.
 */
export interface CashierPermissions {
  voidBills: boolean;
  editStockPrices: boolean;
  /** Override a line price on the bill itself — a discount at the counter,
   *  separate from changing what the product costs in Stock. */
  editBillPrices: boolean;
  createStockItems: boolean;
  addStock: boolean;
  viewReports: boolean;
  viewStockReport: boolean;
  reprintBills: boolean;
}

export const DEFAULT_PERMISSIONS: CashierPermissions = {
  voidBills: false,
  editStockPrices: true,
  editBillPrices: true,
  createStockItems: false,
  addStock: true,
  viewReports: true,
  viewStockReport: false,
  reprintBills: true,
};

const PERMISSIONS_DOC = "settings/cashierPermissions";

export function usePermissions(): { permissions: CashierPermissions; loading: boolean } {
  const [permissions, setPermissions] = useState<CashierPermissions>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      doc(db, PERMISSIONS_DOC),
      (snap) => {
        setPermissions({ ...DEFAULT_PERMISSIONS, ...(snap.data() as Partial<CashierPermissions> | undefined) });
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { permissions, loading };
}

export async function savePermissions(permissions: CashierPermissions) {
  await setDoc(doc(db, PERMISSIONS_DOC), permissions, { merge: true });
}
