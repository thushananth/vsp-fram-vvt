"use client";

import { collection, doc, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { useLive } from "@/lib/firestore/live";
import type { Order, OrderLine, OrderLogEntry, OrderStatus } from "@/lib/types";

/**
 * Advance orders. Placing, editing, cancelling and deleting go through Cloud
 * Functions (functions/src/orders.ts), which number the order and keep its
 * change log. The client itself only sends an order out (with its OR- bill,
 * see createBill in bills.ts) and marks it delivered.
 */

const NO_ORDERS: Order[] = [];
const NO_LOG: OrderLogEntry[] = [];

const STATUSES: OrderStatus[] = ["confirmed", "out", "delivered", "cancelled"];

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toOrder(id: string, d: Record<string, unknown>): Order {
  return {
    id,
    orderNo: num(d.orderNo),
    customerId: (d.customerId as string) ?? "",
    customerName: (d.customerName as string) ?? "",
    deliveryDate: (d.deliveryDate as string) ?? "",
    lines: Array.isArray(d.lines) ? (d.lines as OrderLine[]) : [],
    deliveryCharge: num(d.deliveryCharge),
    notes: (d.notes as string | null) ?? null,
    status: STATUSES.includes(d.status as OrderStatus) ? (d.status as OrderStatus) : "confirmed",
    sendSeq: num(d.sendSeq, 1),
    billId: (d.billId as string | null) ?? null,
    billVoided: d.billVoided === true,
    billVoidedAt: numOrNull(d.billVoidedAt),
    trackToken: (d.trackToken as string) ?? "",
    createdAt: num(d.createdAt),
    createdBy: (d.createdBy as string) ?? "",
    createdByName: (d.createdByName as string) ?? "",
    outAt: numOrNull(d.outAt),
    outBy: (d.outBy as string | null) ?? null,
    deliveredAt: numOrNull(d.deliveredAt),
    deliveredBy: (d.deliveredBy as string | null) ?? null,
    cancelledAt: numOrNull(d.cancelledAt),
    updatedAt: num(d.updatedAt),
  };
}

/**
 * Orders delivered between two days, inclusive ("2026-11-01".."2026-11-30"),
 * by delivery date then number. Always a bounded range: one month for the
 * calendar, today → a few weeks out for the Orders list.
 */
export function useOrders(range: { from: string; to: string } | null): { orders: Order[]; loading: boolean } {
  const key = range ? `orders:range:${range.from}..${range.to}` : null;
  const { data, loading } = useLive<Order[]>(key, (emit, fail) =>
    onSnapshot(
      query(
        collection(db, "orders"),
        where("deliveryDate", ">=", range!.from),
        where("deliveryDate", "<=", range!.to),
        orderBy("deliveryDate", "asc"),
      ),
      (snap) =>
        emit(
          snap.docs
            .map((d) => toOrder(d.id, d.data()))
            .sort((a, b) => (a.deliveryDate === b.deliveryDate ? a.orderNo - b.orderNo : a.deliveryDate < b.deliveryDate ? -1 : 1)),
        ),
      fail,
    ),
  );
  return { orders: data ?? NO_ORDERS, loading };
}

/** One order's change log, oldest first. Admins only — the rules refuse anyone else. */
export function useOrderLog(orderId: string | null, enabled: boolean): { log: OrderLogEntry[]; loading: boolean } {
  const key = orderId && enabled ? `orders:log:${orderId}` : null;
  const { data, loading } = useLive<OrderLogEntry[]>(key, (emit, fail) =>
    onSnapshot(
      collection(db, "orders", orderId!, "log"),
      (snap) =>
        emit(
          snap.docs
            .map((d) => {
              const v = d.data();
              return {
                id: d.id,
                at: num(v.at),
                by: (v.by as string) ?? "",
                byName: (v.byName as string) ?? "",
                action: v.action as OrderLogEntry["action"],
                changes: Array.isArray(v.changes) ? (v.changes as OrderLogEntry["changes"]) : [],
                note: (v.note as string | null) ?? null,
              };
            })
            .sort((a, b) => a.at - b.at),
        ),
      fail,
    ),
  );
  return { log: data ?? NO_LOG, loading };
}

export interface OrderLineInput {
  productId: string;
  qty: number;
  /** A price typed on the line. Honoured for admins, and for cashiers allowed to change bill prices. */
  price?: number;
}

export const placeOrder = httpsCallable<
  { customerId: string; deliveryDate: string; lines: OrderLineInput[]; deliveryCharge: number; notes: string | null },
  { orderId: string; orderNo: number; sms: "sent" | "off" | "no-mobile" | "failed" }
>(functions, "placeOrder");

export const updateOrder = httpsCallable<
  {
    orderId: string;
    /** "delete": admin only. Once out, it deletes (voids) the OR- bill too. Never on a closed order. */
    action: "edit" | "cancel" | "delete";
    changes?: { deliveryDate?: string; lines?: OrderLineInput[]; deliveryCharge?: number; notes?: string | null };
    note?: string | null;
  },
  {
    changed: boolean;
    /** Delete only: the bill deleted with the order, and the customer's balance either side. */
    bill: { label: string; total: number; due: number; paid: number; advanceUsed: number } | null;
    balance: { before: number; after: number } | null;
  }
>(functions, "updateOrder");

/**
 * Back from the delivery. Queued like a sale, so it works with the wifi down;
 * the server logs it and updates the customer's track page when it lands.
 */
export function markDelivered(orderId: string, uid: string): Promise<void> {
  const now = Date.now();
  return updateDoc(doc(db, "orders", orderId), {
    status: "delivered",
    deliveredAt: now,
    deliveredBy: uid,
    updatedAt: now,
    updatedBy: uid,
  });
}
