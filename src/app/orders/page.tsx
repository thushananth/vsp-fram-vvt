"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, Search, X } from "lucide-react";
import NavPending from "@/components/NavPending";
import { usePermissionGate } from "@/components/AdminGate";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { useOrders } from "@/lib/firestore/orders";
import { useCustomerLabel } from "@/lib/customerName";
import { localDateKey } from "@/lib/format";
import {
  dateKeyAdd,
  monthBounds,
  linesSummary,
  orderLabel,
  orderMatches,
  orderPill,
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

/** How far back the list looks for orders still not delivered. */
const PAST_DAYS = 30;

const DONE_RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "custom", label: "Custom" },
] as const;
type DoneRangeKey = (typeof DONE_RANGES)[number]["key"];
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
  const [doneRange, setDoneRange] = useState<DoneRangeKey>("30");
  const [customFrom, setCustomFrom] = useState(() => dateKeyAdd(today, -30));
  const [customTo, setCustomTo] = useState(today);
  const [search, setSearch] = useState("");
  const done = useMemo(() => {
    if (doneRange === "7") return { from: dateKeyAdd(today, -7), to: today };
    if (doneRange === "30") return { from: dateKeyAdd(today, -30), to: today };
    if (doneRange === "month") return { from: monthBounds(today).from, to: today };
    if (doneRange === "lastMonth") return monthBounds(dateKeyAdd(monthBounds(today).from, -1));
    const from = customFrom || today;
    const to = customTo && customTo >= from ? customTo : from;
    return { from, to: to > today ? today : to };
  }, [doneRange, customFrom, customTo, today]);
  // A Done range inside what the main list already holds costs no extra reads.
  const doneInMain = done.from >= range.from && done.to <= range.to;
  const { orders: doneExtra, loading: doneLoading } = useOrders(tab === "Done" && !doneInMain ? done : null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const find = (id: string | null) => (id ? (orders.find((o) => o.id === id) ?? doneExtra.find((o) => o.id === id) ?? null) : null);
  const opened = find(openId);
  const editingOrder = find(editingId);
  const sendingOrder = find(sendingId);

  // A closed order (its bill deleted on Bills) needs nothing more: it lives in Done.
  const todays = orders.filter((o) => o.deliveryDate === today && o.status !== "cancelled" && !o.billVoided);
  const overdue = orders.filter((o) => o.deliveryDate < today && (o.status === "confirmed" || o.status === "out") && !o.billVoided);
  const upcoming = orders.filter((o) => o.deliveryDate > today && o.status !== "cancelled" && !o.billVoided);
  const doneOrders = (doneInMain ? orders : doneExtra)
    .filter(
      (o) =>
        o.deliveryDate >= done.from &&
        o.deliveryDate <= done.to &&
        (o.billVoided || (o.deliveryDate <= today && (o.status === "delivered" || o.status === "cancelled"))),
    )
    .filter((o) => orderMatches(o, search, label(o.customerName)))
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

  const counts: Record<Tab, number> = { Today: todays.length + overdue.length, Upcoming: upcoming.length, Done: tab === "Done" ? doneOrders.length : 0 };

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Orders</h1>
          <p className="text-sm font-medium text-muted">Booked ahead by shops and customers</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/orders/calendar"
            aria-label="Order calendar"
            title="Calendar"
            className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface text-ink"
          >
            <CalendarDays className="h-5 w-5" />
            <NavPending tone="light" />
          </Link>
          <Link
            href="/orders/report"
            aria-label="Order reports"
            title="Order reports"
            className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface text-ink"
          >
            <BarChart3 className="h-5 w-5" />
            <NavPending tone="light" />
          </Link>
          {canManage && (
            <button
              onClick={() => setCreating(true)}
              className="min-h-[48px] rounded-xl bg-accent px-4 text-sm font-bold text-white"
            >
              + New order
            </button>
          )}
        </div>
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
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order no, customer or product"
                aria-label="Search done orders"
                className="min-h-[48px] w-full rounded-xl border border-border bg-ground pl-10 pr-11 text-base outline-none focus:border-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {DONE_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={doneRange === r.key}
                  onClick={() => setDoneRange(r.key)}
                  className={`min-h-[40px] shrink-0 rounded-full border px-3.5 text-sm font-bold ${
                    doneRange === r.key ? "border-ink bg-ink text-white" : "border-border text-muted"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {doneRange === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    max={today}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="min-h-[44px] rounded-xl border border-border bg-ground px-3 text-base font-medium text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                  To
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={today}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="min-h-[44px] rounded-xl border border-border bg-ground px-3 text-base font-medium text-ink"
                  />
                </label>
              </div>
            )}
            <p className="tabular-nums text-xs font-semibold text-muted">
              {shortDate(done.from)} – {shortDate(done.to)} · {doneOrders.length} {doneOrders.length === 1 ? "order" : "orders"}
              {search.trim() && " found"}
            </p>
          </div>
          {!doneInMain && doneLoading && doneExtra.length === 0 ? (
            <SkeletonRows label="Loading orders" rows={4} />
          ) : doneOrders.length === 0 ? (
            <Empty text={search.trim() ? "No done orders match that search." : "No delivered or cancelled orders in these dates."} />
          ) : (
            <div className="flex flex-col gap-2">
              {doneOrders.map((o) => (
                <OrderRow key={o.id} order={o} today={today} showDate canManage={canManage} label={label} onOpen={setOpenId} onSendOut={setSendingId} />
              ))}
            </div>
          )}
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
  const pill = orderPill(order);
  const sendable = canManage && order.status === "confirmed" && order.deliveryDate <= today;
  return (
    <div
      className={`flex items-stretch gap-2 rounded-2xl border border-border bg-surface ${
        order.status === "cancelled" || order.billVoided ? "opacity-60" : ""
      }`}
    >
      <button onClick={() => onOpen(order.id)} className="min-w-0 flex-1 px-3.5 py-3 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tabular-nums text-sm font-bold text-muted">{orderLabel(order.orderNo)}</span>
          <span className="min-w-0 truncate text-base font-bold">{label(order.customerName)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${pill.pill}`}>{pill.label}</span>
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
