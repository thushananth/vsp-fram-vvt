import { randomBytes } from "node:crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import { db } from "./db";
import { CONTACT_LINE, SHOP_NAME, greeting, normalizeMobile, rs, sendSms, smslenzApiKey } from "./sms";

/**
 * Advance orders — a shop books chicken days or weeks ahead.
 *
 *   placeOrder   (callable)  numbers it OR-0043, writes the order, its public
 *                            tracking copy and the first log entry, texts the
 *                            customer "confirmed" with the track link.
 *   updateOrder  (callable)  admin only: edit / reschedule / cancel / reopen,
 *                            every change logged with before and after.
 *   onOrderStatusChanged     the till moves an order to "out" (in the same
 *                            batch as its OR- bill) and later "delivered";
 *                            this logs it, updates tracking, texts the customer.
 *   orderAlertTomorrow 16:00 / orderAlertMorning 06:00, Asia/Colombo.
 *   trackOrder   (HTTP)      what the customer's track page shows. Firestore
 *                            itself stays closed to the public.
 *
 * SMS text is built here, never in the browser. No shop name in it — the
 * sender ID already shows one — and no price until the order goes out.
 */

const TZ = "Asia/Colombo";
const APP_BASE = (process.env.APP_BASE_URL?.trim() || "https://vsp-farm-web.web.app").replace(/\/$/, "");
const TOKEN_LENGTH = 22;
const TOKEN_RE = /^[A-Za-z0-9]{22}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 50;
const MAX_NOTES = 300;
const MAX_ALERT_NUMBERS = 5;
/** A tracking link keeps working this long after the order is delivered or cancelled. */
const TRACK_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
/** Furthest ahead an order can be booked. */
const MAX_DAYS_AHEAD = 365;
const ALREADY_EXISTS = 6;

// ── Dates (Sri Lanka calendar, whatever the server's clock zone) ─────────

export function colomboDateKey(ms: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ms),
  );
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-11-18" → "Wed 18 Nov". */
export function prettyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(",", "");
}

function validDateKey(key: unknown): key is string {
  if (typeof key !== "string" || !DATE_RE.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function orderLabel(no: number): string {
  return `OR-${String(no).padStart(4, "0")}`;
}

function trackLink(token: string): string {
  return `${APP_BASE}/t?k=${token}`;
}

/** 22 characters from [A-Za-z0-9] — about 131 bits, by rejection sampling so every character is equally likely. */
function newToken(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < TOKEN_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < TOKEN_LENGTH) out += alphabet[b % 62];
    }
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function qtyText(qty: number, unit: string): string {
  return `${round3(qty).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unit}`.trim();
}

// ── Settings ─────────────────────────────────────────────────────────────

interface OrderSettings {
  smsConfirmed: boolean;
  smsOut: boolean;
  smsDelivered: boolean;
  smsRescheduled: boolean;
  smsCancelled: boolean;
  tomorrowOn: boolean;
  tomorrowMobiles: string[];
  morningOn: boolean;
  morningMobiles: string[];
}

/** Keep the defaults in step with DEFAULT_STORE_SETTINGS in src/lib/firestore/settings.ts. */
async function orderSettings(): Promise<OrderSettings> {
  const s = (await db.doc("settings/store").get()).data() ?? {};
  const on = (key: string, fallback: boolean) => (typeof s[key] === "boolean" ? (s[key] as boolean) : fallback);
  const numbers = (key: string) => {
    const raw = Array.isArray(s[key]) ? (s[key] as unknown[]) : [];
    const valid = raw.map((r) => (typeof r === "string" ? normalizeMobile(r) : null)).filter((n): n is string => !!n);
    return [...new Set(valid)].slice(0, MAX_ALERT_NUMBERS);
  };
  return {
    smsConfirmed: on("orderSmsConfirmed", true),
    smsOut: on("orderSmsOut", true),
    smsDelivered: on("orderSmsDelivered", false),
    smsRescheduled: on("orderSmsRescheduled", true),
    smsCancelled: on("orderSmsCancelled", true),
    tomorrowOn: on("orderAlertTomorrowOn", true),
    tomorrowMobiles: numbers("orderAlertTomorrowMobiles"),
    morningOn: on("orderAlertMorningOn", true),
    morningMobiles: numbers("orderAlertMorningMobiles"),
  };
}

// ── Who is asking ────────────────────────────────────────────────────────

interface Actor {
  uid: string;
  name: string;
  admin: boolean;
}

/** Active staff who may handle orders: every admin, and a cashier unless an admin switched manageOrders off. */
async function orderActor(uid: string | undefined, { adminOnly = false } = {}): Promise<Actor> {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required");
  const profile = (await db.doc(`users/${uid}`).get()).data();
  if (!profile || profile.active === false) throw new HttpsError("permission-denied", "This account can't manage orders");
  const admin = profile.role === "admin";
  if (adminOnly && !admin) throw new HttpsError("permission-denied", "Only an admin can change a confirmed order");
  if (!admin) {
    const perms = (await db.doc("settings/cashierPermissions").get()).data();
    if (perms?.manageOrders === false) throw new HttpsError("permission-denied", "Orders are switched off for cashiers");
  }
  return { uid, name: typeof profile.name === "string" ? profile.name : "", admin };
}

// ── Messages (keep in step with the previews in src/lib/orders.ts) ───────

function confirmedText(customer: FirebaseFirestore.DocumentData | undefined, no: number, date: string, token: string) {
  return `${greeting(customer)}, your order ${orderLabel(no)} is confirmed for ${prettyDate(date)}.\nTrack: ${trackLink(token)}\n${CONTACT_LINE}`;
}

function outText(no: number, total: number, deliveryCharge: number, token: string) {
  const delivery = deliveryCharge > 0 ? ` (incl. delivery ${rs(deliveryCharge)})` : "";
  return `Your order ${orderLabel(no)} is on the way.\nTotal: ${rs(total)}${delivery}\nTrack: ${trackLink(token)}\n${CONTACT_LINE}`;
}

function deliveredText(no: number) {
  return `Order ${orderLabel(no)} delivered. Thank you for ordering with us!\n${CONTACT_LINE}`;
}

function rescheduledText(no: number, date: string, token: string) {
  return `Your order ${orderLabel(no)} is now for ${prettyDate(date)}.\nTrack: ${trackLink(token)}\n${CONTACT_LINE}`;
}

function cancelledText(no: number, date: string) {
  return `Your order ${orderLabel(no)} for ${prettyDate(date)} has been cancelled. Call us if this is a mistake.\n${CONTACT_LINE}`;
}

interface DigestOrder {
  orderNo: number;
  customerName: string;
  lines: { name: string; qty: number; unit: string }[];
}

export function tomorrowText(orders: DigestOrder[], date: string): string {
  const names = orders.slice(0, 3).map((o) => o.customerName);
  const more = orders.length > 3 ? ` +${orders.length - 3} more` : "";
  const noun = orders.length === 1 ? "order" : "orders";
  return `${orders.length} ${noun} for tomorrow ${prettyDate(date)}: ${names.join(", ")}${more}. Please check the web: ${APP_BASE}/orders`;
}

/** The cashier's prep list: how much of each product to get ready, then the orders. */
export function morningText(orders: DigestOrder[], date: string): string {
  const totals = new Map<string, { name: string; unit: string; qty: number }>();
  for (const o of orders) {
    for (const l of o.lines) {
      const key = `${l.name}|${l.unit}`;
      const t = totals.get(key) ?? { name: l.name, unit: l.unit, qty: 0 };
      t.qty += l.qty;
      totals.set(key, t);
    }
  }
  const products = [...totals.values()];
  const prep = products.slice(0, 8).map((t) => `${t.name} ${qtyText(t.qty, t.unit)}`);
  if (products.length > 8) prep.push(`+${products.length - 8} more products`);
  const list = orders.slice(0, 6).map((o) => `${orderLabel(o.orderNo)} ${o.customerName}`);
  const more = orders.length > 6 ? `, +${orders.length - 6} more in the app` : "";
  const noun = orders.length === 1 ? "order" : "orders";
  return `Good morning. ${orders.length} ${noun} today (${prettyDate(date)}). Please get ready:\n${prep.join("\n")}\nOrders: ${list.join(", ")}${more}`;
}

/** Texting never fails the action it follows — the order is already saved. */
async function textQuietly(contact: string | null, message: string): Promise<boolean> {
  if (!contact) return false;
  try {
    await sendSms(contact, message);
    return true;
  } catch (err) {
    console.error("order SMS failed", err);
    return false;
  }
}

async function customerContact(customerId: string): Promise<{ data: FirebaseFirestore.DocumentData | undefined; contact: string | null }> {
  const data = (await db.doc(`customers/${customerId}`).get()).data();
  return { data, contact: normalizeMobile((data?.mobileNumber as string | undefined) ?? "") };
}

// ── Lines from the browser → priced, named lines from the products ──────

interface LineInput {
  productId?: unknown;
  qty?: unknown;
  price?: unknown;
}

interface OrderLine {
  productId: string;
  name: string;
  categoryId?: string;
  unit: string;
  qty: number;
  price: number;
}

/**
 * Names, units and prices always come from the product records, never from
 * the browser. An admin editing an order may set a line's price; otherwise a
 * product already on the order keeps the price it was booked at.
 */
async function buildLines(
  tx: Transaction,
  input: unknown,
  { allowPrice, booked }: { allowPrice: boolean; booked: Map<string, number> },
): Promise<OrderLine[]> {
  if (!Array.isArray(input) || input.length === 0) throw new HttpsError("invalid-argument", "Add at least one product");
  if (input.length > MAX_LINES) throw new HttpsError("invalid-argument", `At most ${MAX_LINES} products per order`);
  const rows = input as LineInput[];
  const ids = rows.map((r) => r.productId);
  if (ids.some((id) => typeof id !== "string" || id.length === 0 || id.includes("/"))) {
    throw new HttpsError("invalid-argument", "Unknown product");
  }
  const snaps = await tx.getAll(...[...new Set(ids as string[])].map((id) => db.doc(`products/${id}`)));
  const products = new Map(snaps.map((s) => [s.id, s.data()]));

  return rows.map((r) => {
    const p = products.get(r.productId as string);
    if (!p) throw new HttpsError("invalid-argument", "A product on this order no longer exists");
    const qty = typeof r.qty === "number" && Number.isFinite(r.qty) ? round3(r.qty) : NaN;
    if (!(qty > 0 && qty <= 100000)) throw new HttpsError("invalid-argument", `Check the quantity of ${p.name}`);
    let price = booked.get(r.productId as string) ?? (typeof p.price === "number" ? p.price : 0);
    if (allowPrice && r.price !== undefined && r.price !== null) {
      if (typeof r.price !== "number" || !Number.isFinite(r.price) || r.price < 0 || r.price > 10_000_000) {
        throw new HttpsError("invalid-argument", `Check the price of ${p.name}`);
      }
      price = round2(r.price);
    }
    const line: OrderLine = {
      productId: r.productId as string,
      name: String(p.name ?? ""),
      unit: String(p.unit ?? ""),
      qty,
      price,
    };
    if (typeof p.categoryId === "string" && p.categoryId) line.categoryId = p.categoryId;
    return line;
  });
}

function cleanCharge(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1_000_000) {
    throw new HttpsError("invalid-argument", "Check the delivery charge");
  }
  return round2(raw);
}

function cleanNotes(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new HttpsError("invalid-argument", "Notes must be text");
  const t = raw.trim();
  if (t.length > MAX_NOTES) throw new HttpsError("invalid-argument", `Notes can be at most ${MAX_NOTES} characters`);
  return t || null;
}

function checkDeliveryDate(raw: unknown): string {
  if (!validDateKey(raw)) throw new HttpsError("invalid-argument", "Pick a delivery date");
  const today = colomboDateKey();
  if (raw < today) throw new HttpsError("invalid-argument", "The delivery date is in the past");
  if (raw > addDays(today, MAX_DAYS_AHEAD)) throw new HttpsError("invalid-argument", "That date is too far ahead");
  return raw;
}

function trackingLines(lines: OrderLine[]) {
  return lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit }));
}

function describeLines(lines: OrderLine[]): string {
  return lines.map((l) => `${l.name} ${qtyText(l.qty, l.unit)} @ ${rs(l.price)}`).join("; ");
}

function logRef(orderRef: DocumentReference, id?: string) {
  return id ? orderRef.collection("log").doc(id) : orderRef.collection("log").doc();
}

// ── placeOrder ───────────────────────────────────────────────────────────

export const placeOrder = onCall<{
  customerId: string;
  deliveryDate: string;
  lines: LineInput[];
  deliveryCharge?: number;
  notes?: string | null;
}>({ secrets: [smslenzApiKey] }, async (request) => {
  const actor = await orderActor(request.auth?.uid);
  const data = request.data ?? ({} as Record<string, unknown>);
  const customerId = data.customerId;
  if (typeof customerId !== "string" || !customerId || customerId.includes("/")) {
    throw new HttpsError("invalid-argument", "Pick a customer");
  }
  const deliveryDate = checkDeliveryDate(data.deliveryDate);
  const deliveryCharge = cleanCharge(data.deliveryCharge);
  const notes = cleanNotes(data.notes);

  const orderRef = db.collection("orders").doc();
  const token = newToken();
  const now = Date.now();

  const placed = await db.runTransaction(async (tx) => {
    const counterRef = db.doc("counters/orders");
    const [counter, customerSnap] = await Promise.all([tx.get(counterRef), tx.get(db.doc(`customers/${customerId}`))]);
    const customer = customerSnap.data();
    if (!customer || customer.active === false) throw new HttpsError("failed-precondition", "That customer no longer exists");
    const lines = await buildLines(tx, data.lines, { allowPrice: false, booked: new Map() });

    const orderNo = ((counter.data()?.seq as number | undefined) ?? 0) + 1;
    tx.set(counterRef, { seq: orderNo }, { merge: true });

    tx.set(orderRef, {
      orderNo,
      customerId,
      customerName: String(customer.name ?? ""),
      deliveryDate,
      lines,
      deliveryCharge,
      notes,
      status: "confirmed",
      sendSeq: 1,
      billId: null,
      trackToken: token,
      createdAt: now,
      createdBy: actor.uid,
      createdByName: actor.name,
      outAt: null,
      outBy: null,
      deliveredAt: null,
      deliveredBy: null,
      cancelledAt: null,
      updatedAt: now,
      updatedBy: actor.uid,
    });
    tx.set(db.doc(`orderTracking/${token}`), {
      orderNo,
      status: "confirmed",
      deliveryDate,
      lines: trackingLines(lines),
      statusAt: { confirmed: now },
      updatedAt: now,
    });
    tx.set(logRef(orderRef, "placed"), {
      at: now,
      by: actor.uid,
      byName: actor.name,
      action: "placed",
      changes: [],
      note: null,
    });
    return { orderNo, customer };
  });

  let sms: "sent" | "off" | "no-mobile" | "failed" = "off";
  const settings = await orderSettings();
  if (settings.smsConfirmed) {
    const contact = normalizeMobile((placed.customer.mobileNumber as string | undefined) ?? "");
    if (!contact) sms = "no-mobile";
    else {
      sms = (await textQuietly(contact, confirmedText(placed.customer, placed.orderNo, deliveryDate, token))) ? "sent" : "failed";
      if (sms === "sent") await orderRef.update({ "sms.confirmedAt": Date.now() });
    }
  }
  return { orderId: orderRef.id, orderNo: placed.orderNo, sms };
});

// ── updateOrder (admin only) ─────────────────────────────────────────────

type UpdateAction = "edit" | "cancel" | "reopen";

export const updateOrder = onCall<{
  orderId: string;
  action: UpdateAction;
  changes?: { deliveryDate?: string; lines?: LineInput[]; deliveryCharge?: number; notes?: string | null };
  note?: string;
}>({ secrets: [smslenzApiKey] }, async (request) => {
  const actor = await orderActor(request.auth?.uid, { adminOnly: true });
  const { orderId, action } = request.data ?? ({} as { orderId?: string; action?: string });
  if (typeof orderId !== "string" || !orderId || orderId.includes("/")) throw new HttpsError("invalid-argument", "orderId is required");
  if (action !== "edit" && action !== "cancel" && action !== "reopen") throw new HttpsError("invalid-argument", "Unknown action");
  const note = cleanNotes(request.data?.note);
  const orderRef = db.doc(`orders/${orderId}`);
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    const order = snap.data();
    if (!order) throw new HttpsError("not-found", "Order not found");
    const trackRef = db.doc(`orderTracking/${order.trackToken}`);

    if (action === "cancel") {
      if (order.status !== "confirmed") throw new HttpsError("failed-precondition", "Only a confirmed order can be cancelled");
      tx.update(orderRef, { status: "cancelled", cancelledAt: now, updatedAt: now, updatedBy: actor.uid });
      tx.set(
        trackRef,
        { status: "cancelled", "statusAt.cancelled": now, expireAt: Timestamp.fromMillis(now + TRACK_KEEP_MS), updatedAt: now },
        { merge: true },
      );
      tx.set(logRef(orderRef), {
        at: now, by: actor.uid, byName: actor.name, action: "cancelled",
        changes: [{ field: "status", before: "confirmed", after: "cancelled" }], note,
      });
      return { kind: "cancel" as const, order };
    }

    if (action === "reopen") {
      if (order.status !== "out" && order.status !== "delivered") {
        throw new HttpsError("failed-precondition", "Only an order that went out can be reopened");
      }
      const bill = order.billId ? (await tx.get(db.doc(`bills/${order.billId}`))).data() : undefined;
      if (bill && bill.status !== "void") {
        throw new HttpsError("failed-precondition", "Delete (void) its bill first, then reopen the order");
      }
      tx.update(orderRef, {
        status: "confirmed",
        sendSeq: ((order.sendSeq as number | undefined) ?? 1) + 1,
        billId: null,
        outAt: null, outBy: null, deliveredAt: null, deliveredBy: null,
        updatedAt: now, updatedBy: actor.uid,
      });
      tx.set(trackRef, {
        orderNo: order.orderNo,
        status: "confirmed",
        deliveryDate: order.deliveryDate,
        lines: trackingLines(order.lines ?? []),
        statusAt: { confirmed: order.createdAt ?? now },
        updatedAt: now,
      });
      tx.set(logRef(orderRef), {
        at: now, by: actor.uid, byName: actor.name, action: "reopened",
        changes: [{ field: "status", before: String(order.status), after: "confirmed" }], note,
      });
      return { kind: "reopen" as const, order };
    }

    // edit
    if (order.status !== "confirmed") throw new HttpsError("failed-precondition", "Only a confirmed order can be changed");
    const changes = request.data?.changes ?? {};
    const update: Record<string, unknown> = {};
    const diff: { field: string; before: string; after: string }[] = [];

    if (changes.deliveryDate !== undefined && changes.deliveryDate !== order.deliveryDate) {
      const date = checkDeliveryDate(changes.deliveryDate);
      update.deliveryDate = date;
      diff.push({ field: "deliveryDate", before: prettyDate(order.deliveryDate), after: prettyDate(date) });
    }
    if (changes.lines !== undefined) {
      const booked = new Map<string, number>(((order.lines ?? []) as OrderLine[]).map((l) => [l.productId, l.price]));
      const lines = await buildLines(tx, changes.lines, { allowPrice: true, booked });
      const before = describeLines(order.lines ?? []);
      const after = describeLines(lines);
      if (before !== after) {
        update.lines = lines;
        diff.push({ field: "lines", before, after });
      }
    }
    if (changes.deliveryCharge !== undefined) {
      const charge = cleanCharge(changes.deliveryCharge);
      if (charge !== (order.deliveryCharge ?? 0)) {
        update.deliveryCharge = charge;
        diff.push({ field: "deliveryCharge", before: rs(order.deliveryCharge ?? 0), after: rs(charge) });
      }
    }
    if (changes.notes !== undefined) {
      const notes = cleanNotes(changes.notes);
      if (notes !== (order.notes ?? null)) {
        update.notes = notes;
        diff.push({ field: "notes", before: order.notes ?? "", after: notes ?? "" });
      }
    }
    if (diff.length === 0) return { kind: "none" as const, order };

    tx.update(orderRef, { ...update, updatedAt: now, updatedBy: actor.uid });
    tx.set(
      trackRef,
      {
        ...(update.deliveryDate ? { deliveryDate: update.deliveryDate } : {}),
        ...(update.lines ? { lines: trackingLines(update.lines as OrderLine[]) } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
    const onlyDate = diff.length === 1 && diff[0].field === "deliveryDate";
    tx.set(logRef(orderRef), {
      at: now, by: actor.uid, byName: actor.name, action: onlyDate ? "rescheduled" : "edited", changes: diff, note,
    });
    return { kind: "edit" as const, order, newDate: update.deliveryDate as string | undefined };
  });

  // Texts go after the commit, and never undo it.
  const settings = await orderSettings();
  const order = result.order;
  if (result.kind === "cancel" && settings.smsCancelled) {
    const { contact } = await customerContact(order.customerId);
    await textQuietly(contact, cancelledText(order.orderNo, order.deliveryDate));
  }
  if (result.kind === "edit" && result.newDate && settings.smsRescheduled) {
    const { contact } = await customerContact(order.customerId);
    await textQuietly(contact, rescheduledText(order.orderNo, result.newDate, order.trackToken));
  }
  return { changed: result.kind !== "none" };
});

// ── The till sends it out / marks it delivered ───────────────────────────

/**
 * What the cashier changed from the booking, line by line — the booked price
 * against the price charged, and the booked qty against the weighed qty.
 */
function sendOutChanges(order: FirebaseFirestore.DocumentData, bill: FirebaseFirestore.DocumentData) {
  const changes: { field: string; before: string; after: string }[] = [];
  const billLines = (bill.lines ?? []) as { productId: string; name: string; qty: number; price: number }[];
  const booked = (order.lines ?? []) as OrderLine[];
  const seen = new Set<string>();
  for (const b of booked) {
    const charged = billLines.filter((l) => l.productId === b.productId);
    seen.add(b.productId);
    if (charged.length === 0) {
      changes.push({ field: `line:${b.name}`, before: `${qtyText(b.qty, b.unit)} @ ${rs(b.price)}`, after: "removed" });
      continue;
    }
    const qty = round3(charged.reduce((s, l) => s + (l.qty ?? 0), 0));
    const prices = [...new Set(charged.map((l) => l.price))];
    if (prices.some((p) => p !== b.price)) {
      changes.push({ field: `price:${b.name}`, before: rs(b.price), after: prices.map(rs).join(" / ") });
    }
    if (qty !== round3(b.qty)) {
      changes.push({ field: `qty:${b.name}`, before: qtyText(b.qty, b.unit), after: qtyText(qty, b.unit) });
    }
  }
  for (const l of billLines) {
    if (seen.has(l.productId) || l.productId === "delivery") continue;
    seen.add(l.productId);
    changes.push({ field: `line:${l.name}`, before: "not booked", after: `${l.qty} @ ${rs(l.price)}` });
  }
  const chargedDelivery = billLines.filter((l) => l.productId === "delivery").reduce((s, l) => s + l.price * l.qty, 0);
  if (round2(chargedDelivery) !== round2(order.deliveryCharge ?? 0)) {
    changes.push({ field: "deliveryCharge", before: rs(order.deliveryCharge ?? 0), after: rs(chargedDelivery) });
  }
  return { changes, deliveryCharged: round2(chargedDelivery) };
}

async function userName(uid: string | null | undefined): Promise<string> {
  if (!uid) return "";
  const name = (await db.doc(`users/${uid}`).get()).data()?.name;
  return typeof name === "string" ? name : "";
}

/** Writes a log entry under a fixed id. False when it is already there — this event was handled before. */
async function claimLog(ref: DocumentReference, entry: Record<string, unknown>): Promise<boolean> {
  try {
    await ref.create(entry);
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === ALREADY_EXISTS) return false;
    throw err;
  }
}

export const onOrderStatusChanged = onDocumentUpdated(
  // A Firestore trigger has to run where the database is (asia-southeast1).
  { document: "orders/{orderId}", region: "asia-southeast1", secrets: [smslenzApiKey] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after || before.status === after.status) return;
    const orderRef = event.data!.after.ref;
    const seq = (after.sendSeq as number | undefined) ?? 1;
    const trackRef = db.doc(`orderTracking/${after.trackToken}`);

    if (before.status === "confirmed" && after.status === "out") {
      const billRef = db.doc(`bills/${after.billId}`);
      const bill = (await billRef.get()).data();
      if (!bill) {
        console.error(`order ${orderRef.id} went out without bill ${after.billId}`);
        return;
      }
      const { changes, deliveryCharged } = sendOutChanges(after, bill);
      const first = await claimLog(logRef(orderRef, `out-${seq}`), {
        at: after.outAt ?? Date.now(),
        by: after.outBy ?? "",
        byName: await userName(after.outBy),
        action: "out",
        changes,
        note: null,
      });
      if (!first) return;
      await trackRef.set({ status: "out", "statusAt.out": after.outAt ?? Date.now(), updatedAt: Date.now() }, { merge: true });

      const settings = await orderSettings();
      if (!settings.smsOut || bill.smsSentAt) return;
      const { contact } = await customerContact(after.customerId);
      if (await textQuietly(contact, outText(after.orderNo, bill.total ?? 0, deliveryCharged, after.trackToken))) {
        await billRef.update({ smsSentAt: Date.now(), smsTo: contact });
      }
      return;
    }

    if (before.status === "out" && after.status === "delivered") {
      const first = await claimLog(logRef(orderRef, `delivered-${seq}`), {
        at: after.deliveredAt ?? Date.now(),
        by: after.deliveredBy ?? "",
        byName: await userName(after.deliveredBy),
        action: "delivered",
        changes: [],
        note: null,
      });
      if (!first) return;
      const now = Date.now();
      await trackRef.set(
        { status: "delivered", "statusAt.delivered": after.deliveredAt ?? now, expireAt: Timestamp.fromMillis(now + TRACK_KEEP_MS), updatedAt: now },
        { merge: true },
      );
      const settings = await orderSettings();
      if (!settings.smsDelivered) return;
      const { contact } = await customerContact(after.customerId);
      await textQuietly(contact, deliveredText(after.orderNo));
    }
  },
);

// ── Scheduled alerts ─────────────────────────────────────────────────────

async function sendDigest(kind: "tomorrow" | "morning"): Promise<void> {
  const settings = await orderSettings();
  const on = kind === "tomorrow" ? settings.tomorrowOn : settings.morningOn;
  const numbers = kind === "tomorrow" ? settings.tomorrowMobiles : settings.morningMobiles;
  if (!on || numbers.length === 0) return;

  const today = colomboDateKey();
  const date = kind === "tomorrow" ? addDays(today, 1) : today;
  const snap = await db.collection("orders").where("deliveryDate", "==", date).get();
  const orders = snap.docs
    .map((d) => d.data())
    .filter((o) => o.status === "confirmed")
    .sort((a, b) => a.orderNo - b.orderNo) as unknown as DigestOrder[];
  if (orders.length === 0) return;

  // One digest per day and kind, even if the scheduler fires twice.
  const marker = db.doc(`orderDigests/${date}_${kind}`);
  try {
    await marker.create({ at: Date.now(), orders: orders.length, numbers: numbers.length });
  } catch (err) {
    if ((err as { code?: number }).code === ALREADY_EXISTS) return;
    throw err;
  }

  const message = kind === "tomorrow" ? tomorrowText(orders, date) : morningText(orders, date);
  let sent = 0;
  for (const n of numbers) if (await textQuietly(n, message)) sent += 1;
  await marker.update({ sent, expireAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000) });
}

export const orderAlertTomorrow = onSchedule(
  { schedule: "0 16 * * *", timeZone: TZ, secrets: [smslenzApiKey] },
  async () => sendDigest("tomorrow"),
);

export const orderAlertMorning = onSchedule(
  { schedule: "0 6 * * *", timeZone: TZ, secrets: [smslenzApiKey] },
  async () => sendDigest("morning"),
);

// ── Public track endpoint ────────────────────────────────────────────────

/**
 * GET /api/track?k=<22-char token> (Hosting rewrites it here, same origin).
 * Returns only what the customer's own page shows: no customer name, mobile,
 * price or ids. Every miss looks the same, so probing learns nothing.
 */
export const trackOrder = onRequest({ maxInstances: 3, concurrency: 40 }, async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  if (req.method !== "GET") {
    res.status(405).json({ error: "method" });
    return;
  }
  const k = typeof req.query.k === "string" ? req.query.k : "";
  const notFound = () => res.status(404).json({ error: "not-found" });
  if (!TOKEN_RE.test(k)) {
    notFound();
    return;
  }
  const snap = await db.doc(`orderTracking/${k}`).get();
  const t = snap.data();
  const expireAt = t?.expireAt instanceof Timestamp ? t.expireAt.toMillis() : null;
  if (!t || (expireAt !== null && expireAt < Date.now())) {
    notFound();
    return;
  }
  res.json({
    shop: SHOP_NAME,
    contact: CONTACT_LINE,
    order: orderLabel(t.orderNo),
    status: t.status,
    deliveryDate: t.deliveryDate,
    deliveryLabel: prettyDate(t.deliveryDate),
    statusAt: t.statusAt ?? {},
    lines: ((t.lines ?? []) as { name: string; qty: number; unit: string }[]).slice(0, MAX_LINES).map((l) => ({
      name: String(l.name).slice(0, 80),
      qty: qtyText(l.qty, l.unit),
    })),
  });
});

