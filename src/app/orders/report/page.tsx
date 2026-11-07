"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, FileDown, Search, X } from "lucide-react";
import { usePermissionGate } from "@/components/AdminGate";
import NavPending from "@/components/NavPending";
import OrderSheet from "@/components/orders/OrderSheet";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useOrders } from "@/lib/firestore/orders";
import { useCustomerLabel } from "@/lib/customerName";
import { localDateKey, money } from "@/lib/format";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  dateKeyAdd,
  estimatedTotal,
  linesSummary,
  monthBounds,
  orderLabel,
  orderMatches,
  orderPill,
  qtyText,
  shortDate,
} from "@/lib/orders";
import type { OrderReport } from "@/lib/orders";
import type { OrderStatus } from "@/lib/types";

const RANGES = [
  { key: "thisMonth", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "last30", label: "Last 30 days" },
  { key: "next30", label: "Next 30 days" },
  { key: "custom", label: "Custom" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const STATUSES: OrderStatus[] = ["confirmed", "out", "delivered", "cancelled"];
/** A custom range is capped, so one tap can't read years of orders. */
const MAX_DAYS = 366;


export default function OrderReportPage() {
  const gate = usePermissionGate("manageOrders", "Order reports", "An admin has switched advance orders off for cashiers.");
  const { label } = useCustomerLabel();
  const today = localDateKey();

  const [rangeKey, setRangeKey] = useState<RangeKey>("thisMonth");
  const [customFrom, setCustomFrom] = useState(() => monthBounds(today).from);
  const [customTo, setCustomTo] = useState(today);
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [customer, setCustomer] = useState("");
  const [product, setProduct] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (rangeKey === "thisMonth") return monthBounds(today);
    if (rangeKey === "lastMonth") return monthBounds(dateKeyAdd(monthBounds(today).from, -1));
    if (rangeKey === "last30") return { from: dateKeyAdd(today, -30), to: today };
    if (rangeKey === "next30") return { from: today, to: dateKeyAdd(today, 30) };
    const from = customFrom || today;
    let to = customTo && customTo >= from ? customTo : from;
    if (to > dateKeyAdd(from, MAX_DAYS)) to = dateKeyAdd(from, MAX_DAYS);
    return { from, to };
  }, [rangeKey, customFrom, customTo, today]);
  const { orders, loading } = useOrders(range);

  // Choices come from the orders in range, so every option finds something.
  const customers = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) m.set(o.customerId, label(o.customerName));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders, label]);
  const products = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) for (const l of o.lines) m.set(l.productId, l.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [orders]);

  const report = useMemo<OrderReport>(() => {
    const picked = orders.filter(
      (o) =>
        (statuses.length === 0 || statuses.includes(o.status)) &&
        (!customer || o.customerId === customer) &&
        (!product || o.lines.some((l) => l.productId === product)) &&
        orderMatches(o, search, label(o.customerName)),
    );
    const counts = { confirmed: 0, out: 0, delivered: 0, cancelled: 0 } as Record<OrderStatus, number>;
    const byProduct = new Map<string, OrderReport["byProduct"][number]>();
    const byCustomer = new Map<string, OrderReport["byCustomer"][number]>();
    let value = 0;
    let deliveryCharges = 0;
    let billDeleted = 0;
    for (const o of picked) {
      // A closed order sold nothing in the end: counted as closed only, never in
      // the status counts, value or quantities.
      if (o.billVoided) {
        billDeleted += 1;
        continue;
      }
      counts[o.status] += 1;
      if (o.status === "cancelled") continue;
      const est = estimatedTotal(o);
      value += est;
      deliveryCharges += o.deliveryCharge;
      const c = byCustomer.get(o.customerId) ?? { name: label(o.customerName), orders: 0, value: 0 };
      c.orders += 1;
      c.value += est;
      byCustomer.set(o.customerId, c);
      for (const l of o.lines) {
        if (product && l.productId !== product) continue;
        const key = `${l.productId}|${l.unit}`;
        const p = byProduct.get(key) ?? { name: l.name, unit: l.unit, qty: 0, value: 0, orders: 0 };
        p.qty += l.qty;
        p.value += l.qty * l.price;
        p.orders += 1;
        byProduct.set(key, p);
      }
    }
    return {
      label: `${shortDate(range.from)} – ${shortDate(range.to)}`,
      orders: picked,
      counts,
      billDeleted,
      value: Math.round(value * 100) / 100,
      deliveryCharges,
      byProduct: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
      byCustomer: [...byCustomer.values()].sort((a, b) => b.value - a.value),
    };
  }, [orders, statuses, customer, product, search, label, range]);

  const opened = orders.find((o) => o.id === openId) ?? null;

  if (gate) return gate;

  const toggleStatus = (s: OrderStatus) =>
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const filtered = statuses.length > 0 || !!customer || !!product || !!search.trim();
  const live = report.orders.length - report.counts.cancelled - report.billDeleted;

  async function pdf() {
    setBusy(true);
    setError(null);
    try {
      const { downloadOrderReportPdf } = await import("@/lib/pdf/orderReportPdf");
      const filters = [
        statuses.length ? statuses.map((s) => ORDER_STATUS_LABEL[s]).join(", ") : "",
        customer ? (customers.find(([id]) => id === customer)?.[1] ?? "") : "",
        product ? (products.find(([id]) => id === product)?.[1] ?? "") : "",
        search.trim() ? `"${search.trim()}"` : "",
      ].filter(Boolean);
      await downloadOrderReportPdf(report, { from: range.from, to: range.to, filters, nameOf: (o) => label(o.customerName) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 pb-8">
      <div className="flex items-center gap-3">
        <Link
          href="/orders"
          aria-label="Back to Orders"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted"
        >
          <ChevronLeft className="h-5 w-5" />
          <NavPending tone="light" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">Order reports</h1>
          <p className="text-sm font-medium text-muted">By delivery day</p>
        </div>
        <button
          type="button"
          onClick={pdf}
          disabled={busy || report.orders.length === 0}
          className="flex min-h-[48px] shrink-0 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-40"
        >
          <FileDown className="h-4 w-4" />
          {busy ? "Making…" : "PDF"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}

      {/* Filters */}
      <div className="mt-3 flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={rangeKey === r.key}
              onClick={() => setRangeKey(r.key)}
              className={`min-h-[40px] shrink-0 rounded-full border px-3.5 text-sm font-bold ${
                rangeKey === r.key ? "border-ink bg-ink text-white" : "border-border text-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              From
              <input
                type="date"
                value={customFrom}
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
                onChange={(e) => setCustomTo(e.target.value)}
                className="min-h-[44px] rounded-xl border border-border bg-ground px-3 text-base font-medium text-ink"
              />
            </label>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => {
            const on = statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm font-bold ${
                  on ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${ORDER_STATUS_TONE[s].dot}`} />
                {ORDER_STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            aria-label="Customer"
            className="min-h-[48px] rounded-xl border border-border bg-ground px-3 text-base font-medium"
          >
            <option value="">All customers</option>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            aria-label="Product"
            className="min-h-[48px] rounded-xl border border-border bg-ground px-3 text-base font-medium"
          >
            <option value="">All products</option>
            {products.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order no, name, product"
              aria-label="Search orders"
              className="min-h-[48px] w-full rounded-xl border border-border bg-ground pl-10 pr-3 text-base outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="tabular-nums text-xs font-semibold text-muted">
            {report.label} · {report.orders.length} {report.orders.length === 1 ? "order" : "orders"}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setStatuses([]);
                setCustomer("");
                setProduct("");
                setSearch("");
              }}
              className="flex min-h-[40px] items-center gap-1 rounded-lg px-2 text-sm font-bold text-accent"
            >
              <X className="h-4 w-4" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading && orders.length === 0 ? (
        <SkeletonRows label="Loading orders" rows={5} />
      ) : (
        <>
          {/* KPIs */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi dark label="Orders" value={String(live)} note={`not counting ${report.counts.cancelled} cancelled, ${report.billDeleted} closed`} />
            <Kpi label="Est. value" value={money(report.value)} note="at booked prices" />
            <Kpi label="Delivered" value={String(report.counts.delivered)} note={`${report.counts.out} out · ${report.counts.confirmed} to send`} />
            <Kpi
              label="Closed (bill deleted)"
              value={String(report.billDeleted)}
              note={report.deliveryCharges > 0 ? `Delivery ${money(report.deliveryCharges)}` : "no delivery charges"}
            />
          </div>

          {report.orders.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm font-medium text-muted">
              No orders for these dates{filtered ? " and filters" : ""}.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Panel title="By product" note="excluding cancelled">
                <ul className="divide-y divide-border">
                  {report.byProduct.map((p) => (
                    <li key={`${p.name}|${p.unit}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{p.name}</span>
                        <span className="text-xs font-medium text-muted">
                          {p.orders} {p.orders === 1 ? "order" : "orders"}
                        </span>
                      </span>
                      <span className="tabular-nums shrink-0 text-right">
                        <span className="block font-extrabold">{qtyText(p.qty, p.unit)}</span>
                        <span className="text-xs font-medium text-muted">{money(p.value)}</span>
                      </span>
                    </li>
                  ))}
                  {report.byProduct.length === 0 && <li className="px-4 py-4 text-sm text-muted">Only cancelled orders.</li>}
                </ul>
              </Panel>
              <Panel title="By customer" note="excluding cancelled">
                <ul className="divide-y divide-border">
                  {report.byCustomer.slice(0, 15).map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{c.name}</span>
                        <span className="text-xs font-medium text-muted">
                          {c.orders} {c.orders === 1 ? "order" : "orders"}
                        </span>
                      </span>
                      <span className="tabular-nums shrink-0 font-extrabold">{money(c.value)}</span>
                    </li>
                  ))}
                  {report.byCustomer.length === 0 && <li className="px-4 py-4 text-sm text-muted">Only cancelled orders.</li>}
                </ul>
              </Panel>
              <div className="md:col-span-2">
                <Panel title="Orders" note={`${report.orders.length}`}>
                  <ul className="divide-y divide-border">
                    {report.orders.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => setOpenId(o.id)}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 py-3 text-left active:bg-ground ${
                            o.status === "cancelled" || o.billVoided ? "opacity-60" : ""
                          }`}
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="tabular-nums text-sm font-bold text-muted">{orderLabel(o.orderNo)}</span>
                            <span className="truncate font-bold">{label(o.customerName)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${orderPill(o).pill}`}>
                              {orderPill(o).label}
                            </span>
                          </span>
                          <span className="tabular-nums row-span-2 self-center text-right font-extrabold">
                            {o.status === "cancelled" || o.billVoided ? "—" : money(estimatedTotal(o))}
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-sm font-medium text-muted">
                            <span className="font-bold text-ink">{shortDate(o.deliveryDate)} · </span>
                            {linesSummary(o.lines)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </div>
          )}
        </>
      )}

      {opened && (
        <OrderSheet
          order={opened}
          canManage={false}
          readOnly
          onClose={() => setOpenId(null)}
          onSendOut={() => {}}
          onEdit={() => {}}
          onNotice={(text, err) => err && setError(text)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, note, dark }: { label: string; value: string; note?: string; dark?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${dark ? "bg-ink text-white" : "border border-border bg-surface"}`}>
      <div className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-amber-200" : "text-muted-2"}`}>{label}</div>
      <div className="tabular-nums mt-1 text-[22px] font-extrabold leading-tight">{value}</div>
      {note && <div className={`mt-0.5 text-xs font-semibold ${dark ? "text-white/60" : "text-muted"}`}>{note}</div>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {note && <span className="text-xs font-semibold text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}
