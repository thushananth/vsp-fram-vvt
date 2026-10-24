import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "./db";

/**
 * SMS through SMSlenz (smslenz.lk) — the same gateway the VK Riders app uses.
 * The API key never reaches a browser: this app is a static export, so every
 * send goes through a callable here, and the text is built server-side so a
 * till can't be used to send arbitrary messages on the shop's credit.
 */

const SMSLENZ_URL = "https://smslenz.lk/api";

/**
 * The API key lives in Secret Manager, not functions/.env — set it with
 * `firebase functions:secrets:set SMSLENZ_API_KEY`. The user and sender IDs
 * aren't secret and stay in .env.
 */
const smslenzApiKey = defineSecret("SMSLENZ_API_KEY");

// Keep in step with SMS_SHOP_NAME / SMS_CONTACT_LINE in src/lib/sms.ts.
const SHOP_NAME = "VSP FARM";
const CONTACT_LINE = "T.P 077 023 8493 | 077 044 5076";

/** SMSlenz's documented cap for send-sms and send-bulk-sms. */
const MAX_MESSAGE_LENGTH = 1500;
/** The bulk endpoint's own limit isn't documented — stay well under it. */
const BULK_CHUNK = 100;
/** A welcome is for a customer added just now — never one from the migration. */
const WELCOME_WINDOW_MS = 15 * 60 * 1000;

function credentials() {
  const userId = process.env.SMSLENZ_USER_ID?.trim();
  const apiKey = smslenzApiKey.value().trim();
  const senderId = process.env.SMSLENZ_SENDER_ID?.trim();
  if (!userId || !apiKey || !senderId) {
    throw new HttpsError("failed-precondition", "SMS is not set up — SMSLENZ_USER_ID/SMSLENZ_SENDER_ID (functions/.env) or the SMSLENZ_API_KEY secret is missing");
  }
  return { userId, apiKey, senderId };
}

/**
 * A Sri Lankan mobile as 94XXXXXXXXX, or null when it can't be one.
 * Accepts 0771234567, 771234567, 94771234567 and +94 77 123 4567.
 */
export function normalizeMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("94")) digits = `94${digits}`;
  return /^947\d{8}$/.test(digits) ? digits : null;
}

function clip(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) : message;
}

/**
 * POST to an SMSlenz endpoint (JSON body). Success is `"success": true` in the
 * body — an HTTP 200 alone isn't trusted. Numbers go as +94XXXXXXXXX.
 */
async function callSmslenz(
  endpoint: string,
  params: Record<string, unknown>,
  { withSender = true } = {},
): Promise<Record<string, unknown>> {
  const { userId, apiKey, senderId } = credentials();
  const auth = withSender
    ? { user_id: userId, api_key: apiKey, sender_id: senderId }
    : { user_id: userId, api_key: apiKey };
  const response = await fetch(`${SMSLENZ_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...auth, ...params }),
  });
  const text = await response.text();
  let body: { success?: boolean; message?: string; data?: Record<string, unknown> } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON — treated as a failure below, with the raw text logged.
  }
  if (!response.ok || body.success !== true) {
    console.error(`SMSlenz ${endpoint} failed`, response.status, text);
    throw new HttpsError("unavailable", body.message ?? `SMS gateway refused the message (${response.status})`);
  }
  console.log(`SMSlenz ${endpoint} ok`, JSON.stringify(body.data ?? {}));
  return body.data ?? {};
}

/** One message to one number (94XXXXXXXXX). */
export async function sendSms(contact: string, message: string): Promise<void> {
  await callSmslenz("send-sms", { contact: `+${contact}`, message: clip(message) });
}

/** One message to many numbers (94XXXXXXXXX). */
export async function sendBulkSms(contacts: string[], message: string): Promise<void> {
  await callSmslenz("send-bulk-sms", { contacts: contacts.map((c) => `+${c}`), message: clip(message) });
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-US")}`;

/** "Dear Kumar," — or just "Dear customer," for a walk-in saved under their number. */
function greeting(customer: FirebaseFirestore.DocumentData | undefined): string {
  const name = typeof customer?.name === "string" ? customer.name.trim() : "";
  return customer?.autoNamed === true || !name ? "Dear customer" : `Dear ${name}`;
}

function billMessage(bill: FirebaseFirestore.DocumentData, balance: number | null): string {
  const lines = [`Bill #${bill.no}`, `Total: ${rs(bill.total ?? 0)}`];
  if ((bill.advanceUsed ?? 0) > 0) lines.push(`From advance: ${rs(bill.advanceUsed)}`);
  if ((bill.paid ?? 0) > 0) lines.push(`Paid: ${rs(bill.paid)}`);
  if ((bill.due ?? 0) > 0) lines.push(`Due on this bill: ${rs(bill.due)}`);
  if (balance !== null && balance > 0) lines.push(`Total balance owing: ${rs(balance)}`);
  lines.push("", "Thank you for shopping with us!", CONTACT_LINE);
  return lines.join("\n");
}

async function requireSignedIn(uid: string | undefined) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.active === false) {
    throw new HttpsError("permission-denied", "This account can't send SMS");
  }
  return profile;
}

async function requireAdmin(uid: string | undefined) {
  const profile = await requireSignedIn(uid);
  if (profile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }
}

/** settings/store as saved. A switch never saved is on — same as DEFAULT_STORE_SETTINGS. */
async function settingOn(key: string): Promise<boolean> {
  return (await db.doc("settings/store").get()).data()?.[key] !== false;
}

/**
 * Text a bill to its customer. A registered customer's number comes from their
 * record; `mobile` is only taken for a walk-in, typed in at the till. A bill is
 * texted once — a second call is a no-op.
 */
export const sendBillSms = onCall<{ billId: string; mobile?: string }>({ secrets: [smslenzApiKey] }, async (request) => {
  await requireSignedIn(request.auth?.uid);

  const { billId, mobile } = request.data ?? {};
  if (!billId) throw new HttpsError("invalid-argument", "billId is required");

  const billRef = db.doc(`bills/${billId}`);
  const billSnap = await billRef.get();
  if (!billSnap.exists) {
    // Still in the till's offline queue — the client sends only once it lands.
    throw new HttpsError("not-found", "Bill not found yet");
  }
  const bill = billSnap.data()!;
  if (bill.status === "void") throw new HttpsError("failed-precondition", "Bill is void");
  if (bill.smsSentAt) return { sent: false, reason: "already-sent" };

  let contact: string | null;
  let balance: number | null = null;
  if (bill.customerId) {
    const customer = (await db.doc(`customers/${bill.customerId}`).get()).data();
    contact = normalizeMobile((customer?.mobileNumber as string | undefined) ?? "");
    balance = typeof customer?.remainingCredit === "number" ? customer.remainingCredit : null;
  } else {
    contact = normalizeMobile(mobile ?? "");
  }
  if (!contact) throw new HttpsError("invalid-argument", "No valid mobile number for this bill");

  await sendSms(contact, billMessage(bill, balance));
  await billRef.update({ smsSentAt: Date.now(), smsTo: contact });
  return { sent: true };
});

function welcomeMessage(customer: FirebaseFirestore.DocumentData): string {
  return [
    `Welcome to ${SHOP_NAME}!`,
    `${greeting(customer)}, thank you for joining us. We look forward to serving you fresh farm products.`,
    "",
    CONTACT_LINE,
  ].join("\n");
}

/**
 * Welcome a customer just added at the till or on Customers. Only for one
 * created in the last few minutes and never welcomed before — so a stray call
 * can't text the customers brought over from the old app. Quiet when the
 * setting is off or there's no usable number.
 */
export const sendWelcomeSms = onCall<{ customerId: string }>({ secrets: [smslenzApiKey] }, async (request) => {
  await requireSignedIn(request.auth?.uid);

  const { customerId } = request.data ?? {};
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
  if (!(await settingOn("sendWelcomeSms"))) return { sent: false, reason: "off" };

  const ref = db.doc(`customers/${customerId}`);
  const customer = (await ref.get()).data();
  if (!customer) throw new HttpsError("not-found", "Customer not found yet");
  if (customer.welcomedAt) return { sent: false, reason: "already-sent" };
  const createdAt = typeof customer.createdAt === "number" ? customer.createdAt : 0;
  if (Date.now() - createdAt > WELCOME_WINDOW_MS) return { sent: false, reason: "not-new" };

  const contact = normalizeMobile((customer.mobileNumber as string | undefined) ?? "");
  if (!contact) return { sent: false, reason: "no-mobile" };

  await sendSms(contact, welcomeMessage(customer));
  await ref.update({ welcomedAt: Date.now() });
  return { sent: true };
});

/** A payment receipt is for one just taken — not an old or imported one. */
const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function paymentMessage(
  payment: FirebaseFirestore.DocumentData,
  customer: FirebaseFirestore.DocumentData | undefined,
): string {
  const owed = typeof customer?.remainingCredit === "number" ? customer.remainingCredit : 0;
  const held = typeof customer?.advance === "number" ? customer.advance : 0;
  const lines = ["Payment received"];
  if (payment.method === "advance") {
    lines.push(`${greeting(customer)}, ${rs(payment.amount ?? 0)} of your advance was used against your balance.`);
  } else {
    lines.push(`${greeting(customer)}, we received ${rs(payment.amount ?? 0)}. Thank you!`);
    if ((payment.advance ?? 0) > 0) lines.push(`Kept as advance: ${rs(payment.advance)}`);
  }
  lines.push(owed > 0 ? `Balance owing: ${rs(owed)}` : "Your account is fully settled.");
  if (held > 0) lines.push(`Advance held: ${rs(held)}`);
  lines.push("", CONTACT_LINE);
  return lines.join("\n");
}

/**
 * Text a customer the payment they just made and what they owe now. The
 * balance is read after the payment's transaction, so it already reflects it.
 * Once per payment, and only for one taken in the last day.
 */
export const sendPaymentSms = onCall<{ paymentId: string }>({ secrets: [smslenzApiKey] }, async (request) => {
  await requireSignedIn(request.auth?.uid);

  const { paymentId } = request.data ?? {};
  if (!paymentId) throw new HttpsError("invalid-argument", "paymentId is required");

  const ref = db.doc(`creditPayments/${paymentId}`);
  const payment = (await ref.get()).data();
  if (!payment) throw new HttpsError("not-found", "Payment not found");
  if (payment.smsSentAt) return { sent: false, reason: "already-sent" };
  const createdAt = typeof payment.createdAt === "number" ? payment.createdAt : 0;
  if (payment.imported === true || Date.now() - createdAt > PAYMENT_WINDOW_MS) {
    return { sent: false, reason: "not-new" };
  }

  const customer = (await db.doc(`customers/${payment.customerId}`).get()).data();
  const contact = normalizeMobile((customer?.mobileNumber as string | undefined) ?? "");
  if (!contact) throw new HttpsError("failed-precondition", "No valid mobile number on record");

  await sendSms(contact, paymentMessage(payment, customer));
  await ref.update({ smsSentAt: Date.now() });
  return { sent: true };
});

/** A second reminder this soon is almost always a double tap, not a decision. */
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

// Keep in step with reminderPreview in src/lib/sms.ts, which shows it before sending.
function reminderMessage(customer: FirebaseFirestore.DocumentData, owed: number): string {
  return [
    `${greeting(customer)}, your outstanding balance is ${rs(owed)}.`,
    "Please settle it at your earliest convenience. Thank you!",
    "",
    CONTACT_LINE,
  ].join("\n");
}

/**
 * Text a customer what they owe. The amount is read from their record here, so
 * the message always matches the books. At most one reminder an hour each.
 */
export const sendReminderSms = onCall<{ customerId: string }>({ secrets: [smslenzApiKey] }, async (request) => {
  await requireSignedIn(request.auth?.uid);

  const { customerId } = request.data ?? {};
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");

  const ref = db.doc(`customers/${customerId}`);
  const customer = (await ref.get()).data();
  if (!customer || customer.active === false) throw new HttpsError("not-found", "Customer not found");

  const owed = typeof customer.remainingCredit === "number" ? customer.remainingCredit : 0;
  if (owed <= 0) throw new HttpsError("failed-precondition", "Nothing is owed");
  const contact = normalizeMobile((customer.mobileNumber as string | undefined) ?? "");
  if (!contact) throw new HttpsError("failed-precondition", "No valid mobile number on record");

  const last = typeof customer.lastReminderAt === "number" ? customer.lastReminderAt : 0;
  if (Date.now() - last < REMINDER_COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Already reminded in the last hour");
  }

  await sendSms(contact, reminderMessage(customer, owed));
  await ref.update({ lastReminderAt: Date.now() });
  return { sent: true };
});

export type PromoAudience = "all" | "shop" | "person";

/** Upper bound on a hand-picked list — far more than a shop has, small enough for one getAll. */
const MAX_PICKED = 1000;

/** Keep in step with promoText in src/lib/sms.ts, which previews it. */
function promoText(message: string, withContact: boolean): string {
  return withContact ? `${message}\n\n${CONTACT_LINE}` : message;
}

/** Admin-only: one promotional message to every customer of the chosen type with a mobile on record. */
/**
 * Admin-only: one promotional message, either to every customer of a type with
 * a mobile on record, or — with `customerIds` — just to the customers picked.
 * Numbers always come from the customer records, never from the browser.
 */
export const sendPromoSms = onCall<{
  message: string;
  audience?: PromoAudience;
  customerIds?: string[];
  withContact?: boolean;
}>(
  { secrets: [smslenzApiKey] },
  async (request) => {
    await requireAdmin(request.auth?.uid);

    const audience = request.data?.audience ?? "all";
    if (audience !== "all" && audience !== "shop" && audience !== "person") {
      throw new HttpsError("invalid-argument", "audience must be all, shop or person");
    }
    const typed = (request.data?.message ?? "").trim();
    if (!typed) throw new HttpsError("invalid-argument", "Message is empty");
    const message = promoText(typed, request.data?.withContact !== false);
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpsError("invalid-argument", `Message is longer than ${MAX_MESSAGE_LENGTH} characters`);
    }

    const picked = request.data?.customerIds;
    if (picked !== undefined && (!Array.isArray(picked) || picked.length > MAX_PICKED)) {
      throw new HttpsError("invalid-argument", `customerIds must be a list of at most ${MAX_PICKED}`);
    }
    const contacts = picked ? await pickedRecipients(picked) : (await promoRecipients())[audience];
    if (contacts.length === 0) throw new HttpsError("failed-precondition", "No mobile numbers to send to");

    let sent = 0;
    let failed = 0;
    for (let i = 0; i < contacts.length; i += BULK_CHUNK) {
      const chunk = contacts.slice(i, i + BULK_CHUNK);
      try {
        await sendBulkSms(chunk, message);
        sent += chunk.length;
      } catch {
        failed += chunk.length;
      }
    }

    await db.collection("smsCampaigns").add({
      message,
      audience: picked ? "picked" : audience,
      ...(picked ? { customerIds: picked } : {}),
      recipients: contacts.length,
      sent,
      failed,
      sentBy: request.auth!.uid,
      createdAt: Date.now(),
    });
    return { sent, failed };
  },
);

/** Every distinct, valid number among active customers — all of them, and split by type. */
async function promoRecipients(): Promise<Record<PromoAudience, string[]>> {
  const customers = await db.collection("customers").where("active", "==", true).get();
  const byType = { shop: new Set<string>(), person: new Set<string>() };
  for (const d of customers.docs) {
    const n = normalizeMobile((d.data().mobileNumber as string | undefined) ?? "");
    if (n) byType[d.data().type === "shop" ? "shop" : "person"].add(n);
  }
  return {
    all: [...new Set([...byType.shop, ...byType.person])],
    shop: [...byType.shop],
    person: [...byType.person],
  };
}

/** The distinct, valid numbers of the picked customers that are still active. */
async function pickedRecipients(customerIds: string[]): Promise<string[]> {
  const ids = [...new Set(customerIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return [];
  const snaps = await db.getAll(...ids.map((id) => db.doc(`customers/${id}`)));
  const numbers = new Set<string>();
  for (const snap of snaps) {
    const data = snap.data();
    if (!data || data.active === false) continue;
    const n = normalizeMobile((data.mobileNumber as string | undefined) ?? "");
    if (n) numbers.add(n);
  }
  return [...numbers];
}

/** Admin-only: how many numbers each audience would reach, for the compose screen. */
export const countPromoRecipients = onCall(async (request) => {
  await requireAdmin(request.auth?.uid);
  const r = await promoRecipients();
  return { all: r.all.length, shop: r.shop.length, person: r.person.length };
});

/** Admin-only: the SMSlenz account's credit balance, for Settings → SMS. */
export const smsAccountStatus = onCall({ secrets: [smslenzApiKey] }, async (request) => {
  await requireAdmin(request.auth?.uid);
  // account-status takes only user_id and api_key.
  const data = await callSmslenz("account-status", {}, { withSender: false });
  return {
    status: String(data.status ?? ""),
    balance: String(data.sms_credit_balance ?? ""),
    plan: String(data.active_plan ?? ""),
    senderId: process.env.SMSLENZ_SENDER_ID?.trim() ?? "",
  };
});
