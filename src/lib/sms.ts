"use client";

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/**
 * Bill, welcome, reminder and promotion SMS. Sending happens in
 * functions/sms.ts — the SMSlenz key never reaches the browser. The text
 * builders here only preview what the server sends; keep them in step.
 */

export const SMS_SHOP_NAME = "VSP FARM";
export const SMS_CONTACT_LINE = "T.P 077 023 8493 | 077 044 5076";
/** SMSlenz refuses anything longer — same cap as functions/sms.ts. */
export const SMS_MAX_LENGTH = 1500;

/** A Sri Lankan mobile as 94XXXXXXXXX, or null when it can't be one. */
export function normalizeMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("94")) digits = `94${digits}`;
  return /^947\d{8}$/.test(digits) ? digits : null;
}

/** 94771234567 → 0771234567, the way mobiles are kept on a customer. */
export function localMobile(normalized: string): string {
  return `0${normalized.slice(2)}`;
}

export const sendBillSms = httpsCallable<{ billId: string; mobile?: string }, { sent: boolean; reason?: string }>(
  functions,
  "sendBillSms",
);

export const sendWelcomeSms = httpsCallable<{ customerId: string }, { sent: boolean; reason?: string }>(
  functions,
  "sendWelcomeSms",
);

export const sendPaymentSms = httpsCallable<{ paymentId: string }, { sent: boolean; reason?: string }>(
  functions,
  "sendPaymentSms",
);

export const sendReminderSms = httpsCallable<{ customerId: string }, { sent: boolean }>(
  functions,
  "sendReminderSms",
);

export type PromoAudience = "all" | "shop" | "person";

export const sendPromoSms = httpsCallable<
  { message: string; audience: PromoAudience; withContact: boolean; customerIds?: string[] },
  { sent: number; failed: number }
>(functions, "sendPromoSms");

export const countPromoRecipients = httpsCallable<void, Record<PromoAudience, number>>(
  functions,
  "countPromoRecipients",
);

export const smsAccountStatus = httpsCallable<
  void,
  { status: string; balance: string; plan: string; senderId: string }
>(functions, "smsAccountStatus");

function greeting(name: string, autoNamed?: boolean): string {
  return autoNamed || !name.trim() ? "Dear customer" : `Dear ${name.trim()}`;
}

/** What sendReminderSms will text — keep in step with reminderMessage in functions/sms.ts. */
export function reminderPreview(name: string, owed: number, autoNamed?: boolean): string {
  return [
    `${greeting(name, autoNamed)}, your outstanding balance is Rs ${Math.round(owed).toLocaleString("en-US")}.`,
    "Please settle it at your earliest convenience. Thank you!",
    "",
    SMS_CONTACT_LINE,
  ].join("\n");
}

/** What a promotion goes out as — keep in step with promoText in functions/sms.ts. */
export function promoText(message: string, withContact: boolean): string {
  const typed = message.trim();
  return withContact ? `${typed}\n\n${SMS_CONTACT_LINE}` : typed;
}

/** SMS segments: 160 characters each in plain English, 70 once Tamil/Sinhala (Unicode) is in it. */
export function smsSegments(message: string): { segments: number; perSegment: number; unicode: boolean } {
  const unicode = /[^\x00-\x7F]/.test(message);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const n = message.length;
  const segments = n === 0 ? 0 : n <= single ? 1 : Math.ceil(n / multi);
  return { segments, perSegment: n <= single ? single : multi, unicode };
}
