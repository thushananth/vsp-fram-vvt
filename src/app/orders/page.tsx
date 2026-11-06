"use client";

import { useMemo, useState } from "react";
import { usePermissionGate } from "@/components/AdminGate";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { useOrders } from "@/lib/firestore/orders";
import { useCustomerLabel } from "@/lib/customerName";
import { localDateKey } from "@/lib/format";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  dateKeyAdd,
  linesSummary,
  orderLabel,
  qtyText,
  relativeDay,
  shortDate,
} from "@/lib/orders";
import { SkeletonRows } from "@/components/ui/Skeleton";
import OrderForm from "@/components/orders/OrderForm";
import OrderSheet from "@/components/orders/OrderSheet";
import SendOutSheet from "@/components/orders/SendOutSheet";
import type { Order } from "@/lib/types";

const TABS = ["Today", "Upcoming", "Done"] as const;
type Tab = (typeof TABS)[number];

/** How far back the list looks for orders still not delivered, and for Done. */
const PAST_DAYS = 30;
/** How far ahead orders can be booked — matches MAX_DAYS_AHEAD in functions/orders.ts. */
const AHEAD_DAYS = 365;

export default function OrdersPage() {
  const gate = usePermissionGate("manageOrders", "Orders", "An admin has switched advance orders off for cashiers.");
  const { profile } = useAuth();
  const { permissions } = usePermissions();
  const { label } = useCustomerLabel();
  const isAdmin = profile?.role === "admin";
  const canManage = isAdmin || permissions.manageOrders;

  // Day-aligned, so the live-query key only changes when the date does.
  const today = localDateKey();
  const range = useMemo(
    () => ({ from: dateKeyAdd(today, -PAST_DAYS), to: dateKeyAdd(today, AHEAD_DAYS) }),
    [today],
  );
  const { orders, loading } = useOrders(range);

  const [tab, setTab] = useState<Tab>("Today");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const opened = orders.find((o) => o.id === openId) ?? null;
  const editingOrder = orders.find((o) => o.id === editingId) ?? null;
  const sendingOrder = orders.find((o) => o.id === sendingId) ?? null;

  const todays = orders.filter((o) => o.deliveryDate === today && o.status !== "cancelled");
  const overdue = orders.filter((o) => o.deliveryDate < today && (o.status === "confirmed" || o.status === "out"));
  const upcoming = orders.filter((o) => o.deliveryDate > today && o.status !== "cancelled");
  const done = orders
    .filter((o) => o.deliveryDate <= today && (o.status === "delivered" || o.status === "cancelled"))
    .reverse();

  // The morning prep list: everything still to send out today, by product.
  const prep = useMemo(() => {
    const totals = new Map<string, { name: string; unit: string; qty: number }>();
    for (const o of [...overdue, ...todays].filter((x) => x.status === "confirmed")) {
      for (const l of o.lines) {
        const key = `${l.productId}|${l.unit}`;
        const t = totals.get(key) ?? { name: l.name, unit: l.unit, qty: 0 };
        t.qty += l.qty;
        totals.set(key, t);
      }
    }
    return [...totals.values()];
  }, [overdue, todays]);

  if (gate) return gate;

  function say(text: string, error = false) {
    setNotice({ text, error });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), error ? 8000 : 3500);
  }

  const counts: Record<Tab, number> = { Today: todays.length + overdue.length, Upcoming: upcoming.length, Done: done.length };

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Orders</h1>
          <p className="text-sm font-medium text-muted">Booked ahead by shops and customers</p>
        </div>
        {canManage && (
          <button
            onClick={() => setCreating(true)}
            className="min-h-[48px] shrink-0 rounded-xl bg-accent px-4 text-sm font-bold text-white"
          >
            + New order
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-1 rounded-xl bg-ground p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-bold ${tab === t ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {t}
            {counts[t] > 0 && <span className="tabular-nums ml-1.5 text-xs font-extrabold text-accent">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {loading && orders.length === 0 ? (
        <SkeletonRows label="Loading orders" rows={4} />
      ) : tab === "Today" ? (
        <div className="mt-3 flex flex-col gap-4">
          {prep.length > 0 && (
            <section className="rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-accent">Get ready for today</h2>
              <ul className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {prep.map((p) => (
                  <li key={`${p.name}|${p.unit}`} className="flex justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{p.name}</span>
                    <span className="tabular-nums shrink-0 font-extrabold">{qtyText(p.qty, p.unit)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {overdue.length > 0 && (
            <OrderGroup title="Still to finish from earlier days" tone="warning">
              {overdue.map((o) => (
                <OrderRow key={o.id} order={o} today={today} showDate canManage={canManage} label={label} onOpen={setOpenId} onSendOut={setSendingId} />
              ))}
            </OrderGroup>
          )}
          {todays.length > 0 ? (
            <OrderGroup title={`Today · ${shortDate(today)}`}>
              {todays.map((o) => (
                <OrderRow key={o.id} order={o} today={today} canManage={canManage} label={label} onOpen={setOpenId} onSendOut={setSendingId} />
              ))}
            </OrderGroup>
          ) : (
            overdue.length === 0 && <Empty text="No orders to deliver today." />
          )}
        </div>
      ) : tab === "Upcoming" ? (
        upcoming.length === 0 ? (
          <Empty text="Nothing booked ahead yet. Tap + New order when a shop calls." />
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {groupByDate(upcoming).map(([date, group]) => (
              <OrderGroup key={date} title={`${relativeDay(date, today)}${relativeDay(date, today) === shortDate(date) ? "" : ` · ${shortDate(date)}`} · ${group.length} ${group.length === 1 ? "order" : "orders"}`}>
                {group.map((o) => (
                  <OrderRow key={o.id} order={o} today={today} canManage={canManage} label={label} onOpen={setOpenId} onSendOut={setSendingId} />
                ))}
              </OrderGroup>
            ))}
          </div>
        )
      ) : done.length === 0 ? (
        <Empty text={`No delivered or cancelled orders in the last ${PAST_DAYS} days.`} />
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {done.map((o) => (
            <OrderRow key={o.id} order={o} today={today} showDate canManage={canManage} label={label} onOpen={setOpenId} onSendOut={setSendingId} />
          ))}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg md:bottom-6 ${
            notice.error ? "bg-danger" : "bg-ink"
          }`}
        >
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {opened && !sendingOrder && !editingOrder && (
        <OrderSheet
          order={opened}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onSendOut={() => setSendingId(opened.id)}
          onEdit={() => setEditingId(opened.id)}
          onNotice={say}
        />
      )}
      {sendingOrder && (
        <SendOutSheet
          order={sendingOrder}
          onClose={() => setSendingId(null)}
          onSent={(text, error) => {
            setSendingId(null);
            setOpenId(null);
            say(text, error);
          }}
        />
      )}
      {creating && (
        <OrderForm
          isAdmin={isAdmin}
          onClose={() => setCreating(false)}
          onSaved={(text) => {
            setCreating(false);
            say(text);
          }}
        />
      )}
      {editingOrder && (
        <OrderForm
          order={editingOrder}
          isAdmin={isAdmin}
          onClose={() => setEditingId(null)}
          onSaved={(text) => {
            setEditingId(null);
            say(text);
          }}
        />
      )}
    </div>
  );
}

function groupByDate(orders: Order[]): [string, Order[]][] {
  const groups = new Map<string, Order[]>();
  for (const o of orders) groups.set(o.deliveryDate, [...(groups.get(o.deliveryDate) ?? []), o]);
  return [...groups.entries()];
}

function OrderGroup({ title, tone, children }: { title: string; tone?: "warning"; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`text-[11px] font-bold uppercase tracking-wider ${tone === "warning" ? "text-warning" : "text-muted-2"}`}>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-3 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-muted">{text}</p>;
}

function OrderRow({
  order,
  today,
  showDate = false,
  canManage,
  label,
  onOpen,
  onSendOut,
}: {
  order: Order;
  today: string;
  showDate?: boolean;
  canManage: boolean;
  label: (name: string) => string;
  onOpen: (id: string) => void;
  onSendOut: (id: string) => void;
}) {
  const tone = ORDER_STATUS_TONE[order.status];
  const sendable = canManage && order.status === "confirmed" && order.deliveryDate <= today;
  return (
    <div
      className={`flex items-stretch gap-2 rounded-2xl border border-border bg-surface ${order.status === "cancelled" ? "opacity-60" : ""}`}
    >
      <button onClick={() => onOpen(order.id)} className="min-w-0 flex-1 px-3.5 py-3 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular-nums text-sm font-bold text-muted">{orderLabel(order.orderNo)}</span>
          <span className="min-w-0 truncate text-base font-bold">{label(order.customerName)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone.pill}`}>{ORDER_STATUS_LABEL[order.status]}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-sm font-medium text-muted">
          {showDate && <span className="font-bold text-ink">{relativeDay(order.deliveryDate, today)} · </span>}
          {linesSummary(order.lines)}
        </div>
        {order.notes && <div className="mt-0.5 truncate text-xs font-semibold text-muted-2">Note: {order.notes}</div>}
      </button>
      {sendable && (
        <button
          onClick={() => onSendOut(order.id)}
          className="m-2 min-h-[48px] shrink-0 rounded-xl bg-accent px-4 text-sm font-extrabold text-white"
        >
          Send out
        </button>
      )}
    </div>
  );
}
