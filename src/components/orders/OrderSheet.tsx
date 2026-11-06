"use client";

import { useState } from "react";
import { Copy, X } from "lucide-react";
import { markDelivered, updateOrder, useOrderLog } from "@/lib/firestore/orders";
import { useAuth } from "@/lib/auth";
import { useCustomerLabel } from "@/lib/customerName";
import { useOnline } from "@/lib/online";
import { dateAndTime, money } from "@/lib/format";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  estimatedTotal,
  longDate,
  orderLabel,
  qtyText,
} from "@/lib/orders";
import type { Order, OrderLogEntry } from "@/lib/types";

const ACTION_LABEL: Record<OrderLogEntry["action"], string> = {
  placed: "Placed",
  edited: "Changed",
  rescheduled: "Date moved",
  cancelled: "Cancelled",
  reopened: "Reopened",
  out: "Sent out",
  delivered: "Delivered",
};

const FIELD_LABEL: Record<string, string> = {
  deliveryDate: "Delivery day",
  lines: "Products",
  deliveryCharge: "Delivery charge",
  notes: "Notes",
  status: "Status",
};

function fieldLabel(field: string): string {
  const [kind, name] = field.split(/:(.*)/);
  if (name) return kind === "price" ? `Price of ${name}` : kind === "qty" ? `Qty of ${name}` : name;
  return FIELD_LABEL[field] ?? field;
}

export default function OrderSheet({
  order,
  canManage,
  onClose,
  onSendOut,
  onEdit,
  onNotice,
}: {
  order: Order;
  canManage: boolean;
  onClose: () => void;
  onSendOut: () => void;
  onEdit: () => void;
  onNotice: (text: string, error?: boolean) => void;
}) {
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { label } = useCustomerLabel();
  const online = useOnline();
  const { log, loading: logLoading } = useOrderLog(order.id, isAdmin);
  const [confirming, setConfirming] = useState<"cancel" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = ORDER_STATUS_TONE[order.status];
  const trackUrl = typeof window !== "undefined" && order.trackToken ? `${window.location.origin}/t?k=${order.trackToken}` : "";

  async function deliver() {
    const uid = profile?.uid ?? user?.uid;
    if (!uid) return;
    // Queued offline like a sale; only a refusal is worth telling anyone about.
    markDelivered(order.id, uid).catch((err: Error) => onNotice(`Couldn't mark ${orderLabel(order.orderNo)} delivered: ${err.message}`, true));
    onNotice(`${orderLabel(order.orderNo)} delivered`);
    onClose();
  }

  async function adminAction(action: "cancel" | "reopen") {
    setBusy(true);
    try {
      await updateOrder({ orderId: order.id, action, note: reason.trim() || null });
      onNotice(action === "cancel" ? `${orderLabel(order.orderNo)} cancelled` : `${orderLabel(order.orderNo)} reopened. Send it out again when ready.`);
      onClose();
    } catch (err) {
      onNotice((err as Error).message, true);
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(trackUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onNotice("Couldn't copy. Long-press the link to copy it.", true);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={orderLabel(order.orderNo)}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[100dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface sm:max-h-[92dvh] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="tabular-nums text-xl font-extrabold">{orderLabel(order.orderNo)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.pill}`}>{ORDER_STATUS_LABEL[order.status]}</span>
            </div>
            <div className="truncate text-base font-bold">{label(order.customerName)}</div>
            <div className="text-sm font-medium text-muted">{longDate(order.deliveryDate)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {order.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0 truncate font-semibold">{l.name}</span>
                <span className="tabular-nums shrink-0 text-right">
                  <span className="font-extrabold">{qtyText(l.qty, l.unit)}</span>
                  <span className="ml-2 text-xs font-medium text-muted">@ {money(l.price)}</span>
                </span>
              </li>
            ))}
            {order.deliveryCharge > 0 && (
              <li className="flex items-center justify-between px-3.5 py-2.5">
                <span className="font-semibold text-muted">Delivery charge</span>
                <span className="tabular-nums font-extrabold">{money(order.deliveryCharge)}</span>
              </li>
            )}
            <li className="flex items-center justify-between bg-ground px-3.5 py-2.5">
              <span className="text-sm font-bold text-muted">
                {order.status === "out" || order.status === "delivered" ? "Booked estimate (see the bill for the total)" : "Estimate at booked prices"}
              </span>
              <span className="tabular-nums font-extrabold">{money(estimatedTotal(order))}</span>
            </li>
          </ul>

          {order.notes && (
            <p className="rounded-xl bg-ground px-3.5 py-2.5 text-sm font-medium">
              <span className="font-bold">Note: </span>
              {order.notes}
            </p>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-semibold text-muted">Placed</dt>
            <dd className="tabular-nums font-medium">
              {dateAndTime(order.createdAt)}
              {order.createdByName && ` by ${order.createdByName}`}
            </dd>
            {order.outAt && (
              <>
                <dt className="font-semibold text-muted">Sent out</dt>
                <dd className="tabular-nums font-medium">{dateAndTime(order.outAt)}</dd>
              </>
            )}
            {order.deliveredAt && (
              <>
                <dt className="font-semibold text-muted">Delivered</dt>
                <dd className="tabular-nums font-medium">{dateAndTime(order.deliveredAt)}</dd>
              </>
            )}
            {order.cancelledAt && (
              <>
                <dt className="font-semibold text-muted">Cancelled</dt>
                <dd className="tabular-nums font-medium">{dateAndTime(order.cancelledAt)}</dd>
              </>
            )}
          </dl>

          {trackUrl && order.status !== "cancelled" && (
            <div className="flex items-center gap-2 rounded-xl border border-border px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Customer&apos;s track link</div>
                <div className="truncate select-all text-sm font-medium">{trackUrl}</div>
              </div>
              <button
                type="button"
                onClick={copyLink}
                className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-bold"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          {isAdmin && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Change log</h3>
              {logLoading && log.length === 0 ? (
                <div className="skeleton-in flex flex-col gap-1.5">
                  <span className="skeleton block h-10 rounded-xl" />
                  <span className="skeleton block h-10 rounded-xl" />
                </div>
              ) : (
                <ol className="flex flex-col gap-2">
                  {log.map((e) => (
                    <li key={e.id} className="rounded-xl border border-border px-3.5 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-bold">{ACTION_LABEL[e.action] ?? e.action}</span>
                        <span className="tabular-nums text-xs font-medium text-muted">
                          {dateAndTime(e.at)}
                          {e.byName && ` · ${e.byName}`}
                        </span>
                      </div>
                      {e.changes.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {e.changes.map((c, i) => (
                            <li key={i} className="text-xs font-medium text-muted">
                              <span className="font-bold text-ink">{fieldLabel(c.field)}:</span> {c.before || "none"} → {c.after || "none"}
                            </li>
                          ))}
                        </ul>
                      )}
                      {e.note && <p className="mt-1 text-xs font-medium italic text-muted">“{e.note}”</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>

        {confirming ? (
          <div className="flex flex-col gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <p className="text-sm font-bold">
              {confirming === "cancel"
                ? `Cancel ${orderLabel(order.orderNo)}? The customer is texted if that SMS is on.`
                : "Reopen this order? Its bill must already be deleted (voided) on Bills. The order goes back to Confirmed."}
            </p>
            <input
              id="order-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="Reason (kept in the change log)"
              className="w-full rounded-xl border border-border px-3.5 py-3 text-base outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="min-h-[52px] flex-1 rounded-2xl border border-border font-bold text-muted"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy || !online}
                onClick={() => adminAction(confirming)}
                className={`min-h-[52px] flex-[2] rounded-2xl font-bold text-white disabled:opacity-40 ${
                  confirming === "cancel" ? "bg-danger" : "bg-accent"
                }`}
              >
                {busy ? "Saving…" : confirming === "cancel" ? "Cancel order" : "Reopen order"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {isAdmin && order.status === "confirmed" && (
              <>
                <button
                  type="button"
                  disabled={!online}
                  onClick={onEdit}
                  className="min-h-[52px] flex-1 rounded-2xl border border-border px-4 font-bold disabled:opacity-40"
                >
                  Change
                </button>
                <button
                  type="button"
                  disabled={!online}
                  onClick={() => setConfirming("cancel")}
                  className="min-h-[52px] flex-1 rounded-2xl border border-danger/40 px-4 font-bold text-danger disabled:opacity-40"
                >
                  Cancel order
                </button>
              </>
            )}
            {isAdmin && (order.status === "out" || order.status === "delivered") && (
              <button
                type="button"
                disabled={!online}
                onClick={() => setConfirming("reopen")}
                className="min-h-[52px] flex-1 rounded-2xl border border-border px-4 font-bold disabled:opacity-40"
              >
                Reopen
              </button>
            )}
            {canManage && order.status === "confirmed" && (
              <button
                type="button"
                onClick={onSendOut}
                className="min-h-[56px] flex-[2] rounded-2xl bg-accent px-5 text-base font-extrabold text-white"
              >
                Send out
              </button>
            )}
            {canManage && order.status === "out" && (
              <button
                type="button"
                onClick={deliver}
                className="min-h-[56px] flex-[2] rounded-2xl bg-success px-5 text-base font-extrabold text-white"
              >
                Mark delivered
              </button>
            )}
          </div>
        )}
        {!online && confirming === null && isAdmin && (
          <p className="px-5 pb-3 text-xs font-semibold text-warning">Changing, cancelling or reopening needs the internet.</p>
        )}
      </div>
    </div>
  );
}
