"use client";

import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLive } from "@/lib/firestore/live";

/**
 * Store-wide settings, admin-editable from Settings. Unlike CashierPermissions
 * these apply to *everyone* including admins — they are shop policy, not a
 * per-role capability.
 */
export interface StoreSettings {
  /** Auto-print a receipt on the thermal printer when a sale is charged.
   *  The cashier can still skip it for one bill from the basket. */
  printBills: boolean;
  /** Also print the counter copy for bills with items from a category marked
   *  "counter copy" (chicken, in practice). */
  printCounterCopy: boolean;
  /**
   * How far short a walk-in may pay and still be charged — Rs 1010 paid with
   * 1000 when this is 10 or more. The bill is recorded at what was paid and
   * the difference kept as a round-off discount. 0 means pay in full.
   */
  walkInRoundOff: number;
  /** Roll width — decides how many characters fit on a receipt line. */
  paperWidth: 58 | 80;
  /** Require every new browser/device to be approved before it can be used. */
  deviceVerification: boolean;
  /** Where new-device approval codes are emailed. Empty means every active
   *  admin's login email. */
  deviceApprovalEmails: string[];
  /** Text the bill to the customer when a sale is charged. The cashier can
   *  still untick it for one bill from the basket. */
  sendBillSms: boolean;
  /** Text a welcome to every customer added from now on (functions/ reads
   *  this from the saved doc, treating "never saved" as on). */
  sendWelcomeSms: boolean;
  /** Text the customer a receipt when a credit payment is taken. The cashier
   *  can still untick it for one payment. */
  sendPaymentSms: boolean;
  // Advance orders — functions/orders.ts reads these with the same defaults.
  /** Text the customer "order confirmed" with the track link. */
  orderSmsConfirmed: boolean;
  /** Text the customer "on the way" with the bill total when it goes out. */
  orderSmsOut: boolean;
  /** Text the customer when it's marked delivered. Off by default to save credit. */
  orderSmsDelivered: boolean;
  /** Text the customer when an admin moves the delivery date. */
  orderSmsRescheduled: boolean;
  /** Text the customer when an admin cancels the order. */
  orderSmsCancelled: boolean;
  /** 16:00 the day before: "3 orders for tomorrow" to these numbers. */
  orderAlertTomorrowOn: boolean;
  orderAlertTomorrowMobiles: string[];
  /** 06:00 on the day: the cashier's prep list to these numbers. */
  orderAlertMorningOn: boolean;
  orderAlertMorningMobiles: string[];
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  printBills: true,
  printCounterCopy: true,
  // The old app refused a cash bill once it was Rs 20 or more short.
  walkInRoundOff: 20,
  paperWidth: 80,
  // Off until an admin turns it on: with no SMTP configured and no approved
  // device yet, defaulting this on would lock a working shop out of its till.
  deviceVerification: false,
  deviceApprovalEmails: [],
  sendBillSms: true,
  sendWelcomeSms: true,
  sendPaymentSms: true,
  orderSmsConfirmed: true,
  orderSmsOut: true,
  orderSmsDelivered: false,
  orderSmsRescheduled: true,
  orderSmsCancelled: true,
  orderAlertTomorrowOn: true,
  orderAlertTomorrowMobiles: [],
  orderAlertMorningOn: true,
  orderAlertMorningMobiles: [],
};

const STORE_DOC = "settings/store";

export function useStoreSettings(): { settings: StoreSettings; loading: boolean } {
  const { data, loading } = useLive<StoreSettings>(`doc:${STORE_DOC}`, (emit, fail) =>
    onSnapshot(
      doc(db, STORE_DOC),
      (snap) => emit({ ...DEFAULT_STORE_SETTINGS, ...(snap.data() as Partial<StoreSettings> | undefined) }),
      fail,
    ),
  );
  return { settings: data ?? DEFAULT_STORE_SETTINGS, loading };
}

export async function saveStoreSettings(settings: StoreSettings) {
  await setDoc(doc(db, STORE_DOC), settings, { merge: true });
}
