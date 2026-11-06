"use client";

import { useMemo, useState } from "react";
import { useAdminGate } from "@/components/AdminGate";
import { useBills } from "@/lib/firestore/bills";
import { useUsers } from "@/lib/firestore/users";
import { useProducts } from "@/lib/firestore/products";
import { useCategories } from "@/lib/firestore/categories";
import { buildSalesReport } from "@/lib/salesReport";
import Stat from "@/components/ui/Stat";
import { money, initials, localDateKey } from "@/lib/format";

const dayKey = localDateKey;

export default function DashboardPage() {
  const gate = useAdminGate("The dashboard", "It covers the whole shop's takings and staff, so it stays with admins.");
  // Only what the charts cover — this month and the five before it — so the
  // dashboard doesn't download every bill ever written each time it opens.
  const [span] = useState(() => {
    const now = new Date();
    return {
      startMs: new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime(),
      endMs: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
    };
  });
  const { bills, loading: billsLoading } = useBills(span);
  const { users, loading: usersLoading } = useUsers();
  const { products } = useProducts({ includeInactive: true });
  const { categories } = useCategories();
  // The bar tapped for a category breakdown — a day ("2026-10-25") or a month ("2026-10").
  const [picked, setPicked] = useState<string | null>(null);

  const today = localDateKey();
  const paidBills = useMemo(() => bills.filter((b) => b.status === "paid"), [bills]);
  const todaysBills = useMemo(() => paidBills.filter((b) => dayKey(b.createdAt) === today), [paidBills, today]);

  const weekDays = useMemo(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(localDateKey(d.getTime()));
    }
    return days;
  }, []);

  const weekBars = useMemo(() => {
    const totals = weekDays.map((day) => ({
      day,
      total: paidBills.filter((b) => dayKey(b.createdAt) === day).reduce((s, b) => s + b.total, 0),
    }));
    const max = Math.max(1, ...totals.map((t) => t.total));
    return totals.map((t) => ({
      ...t,
      pct: Math.round((t.total / max) * 100),
      // Parsed as local midnight — a bare "yyyy-mm-dd" would parse as UTC.
      label: new Date(`${t.day}T00:00:00`).toLocaleDateString("en-LK", { weekday: "short" }).slice(0, 3),
    }));
  }, [paidBills, weekDays]);

  const weekTotal = weekBars.reduce((s, w) => s + w.total, 0);
  const todayTotal = todaysBills.reduce((s, b) => s + b.total, 0);

  const monthBars = useMemo(() => {
    const months: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-LK", { month: "short" }),
      });
    }
    const totals = months.map((m) => ({
      ...m,
      total: paidBills
        .filter((b) => localDateKey(b.createdAt).slice(0, 7) === m.key)
        .reduce((s, b) => s + b.total, 0),
    }));
    const max = Math.max(1, ...totals.map((t) => t.total));
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return totals.map((t) => ({ ...t, pct: Math.round((t.total / max) * 100), isCurrent: t.key === thisMonthKey }));
  }, [paidBills]);

  const monthTotal = monthBars.reduce((s, m) => s + m.total, 0);

  const breakdown = useMemo(() => {
    if (!picked) return null;
    const isDay = picked.length === 10;
    const [y, m, d] = picked.split("-").map(Number);
    const start = isDay ? new Date(y, m - 1, d) : new Date(y, m - 1, 1);
    const end = isDay ? new Date(y, m - 1, d + 1) : new Date(y, m, 1);
    // Paid bills only, the same set the bars are drawn from.
    const report = buildSalesReport({
      bills: paidBills,
      payments: [],
      customers: [],
      products,
      categories,
      startMs: start.getTime(),
      endMs: end.getTime(),
    });
    return {
      isDay,
      title: isDay
        ? start.toLocaleDateString("en-LK", { weekday: "long", day: "numeric", month: "short" })
        : start.toLocaleDateString("en-LK", { month: "long", year: "numeric" }),
      total: report.totals.net,
      bills: report.totals.bills,
      roundOff: report.totals.roundOff,
      categories: report.byCategory.map((c) => ({
        ...c,
        products: report.byProduct.filter((p) => p.category === c.name),
      })),
    };
  }, [picked, paidBills, products, categories]);
  const togglePick = (key: string) => setPicked((cur) => (cur === key ? null : key));

  const voidCount = bills.filter((b) => b.status === "void").length;
  const returnRate = paidBills.length ? Math.round((voidCount / paidBills.length) * 100) : 0;

  const itemCounts = new Map<string, number>();
  for (const b of paidBills) {
    for (const l of b.lines) itemCounts.set(l.name, (itemCounts.get(l.name) ?? 0) + l.qty);
  }
  const topItem = [...itemCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const dashStats = [
    { label: "Today", value: money(todayTotal), note: `${todaysBills.length} bills`, color: "text-muted" },
    { label: "This week", value: money(weekTotal), note: "7 days", color: "text-muted" },
    { label: "Void rate", value: `${returnRate}%`, note: `${voidCount} voided`, color: "text-muted" },
    { label: "Top item", value: topItem?.[0] ?? "—", note: topItem ? `${topItem[1]} sold` : "", color: "text-muted" },
  ];

  const cashiers = useMemo(() => {
    return users
      .filter((u) => u.role === "cashier")
      .map((u) => {
        const theirBills = todaysBills.filter((b) => b.cashierId === u.uid);
        return {
          uid: u.uid,
          name: u.name,
          bills: theirBills.length,
          takings: theirBills.reduce((s, b) => s + b.total, 0),
        };
      });
  }, [users, todaysBills]);

  const unsyncedCount = bills.filter((b) => !b.synced).length;

  const alerts = [
    unsyncedCount > 0 && {
      title: `${unsyncedCount} unsynced bill${unsyncedCount === 1 ? "" : "s"}`,
      body: "Waiting to sync once the connection is back.",
      mark: "border-l-warning",
    },
    voidCount > 0 && {
      title: `${voidCount} voided bill${voidCount === 1 ? "" : "s"}`,
      body: "Review void reasons in Bills.",
      mark: "border-l-danger",
    },
  ].filter(Boolean) as { title: string; body: string; mark: string }[];


  const loading = billsLoading || usersLoading;


  // Denied by default until the profile says otherwise.
  if (gate) return gate;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="text-sm font-medium text-muted">Store performance at a glance</p>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {dashStats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} note={s.note} noteColor={s.color} />
            ))}
          </div>

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Last 7 days</h2>
          <div className="rounded-2xl border border-border bg-surface p-4 pb-2.5">
            <div className="flex h-[140px] items-end gap-2.5">
              {weekBars.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  onClick={() => togglePick(d.day)}
                  aria-pressed={picked === d.day}
                  className={`flex h-full flex-1 flex-col items-center justify-end gap-1.5 rounded-lg transition-opacity ${
                    picked && picked.length === 10 && picked !== d.day ? "opacity-45" : ""
                  }`}
                >
                  <span className="tabular-nums text-[11px] font-bold text-muted">
                    {d.total > 0 ? Math.round(d.total / 1000) + "k" : ""}
                  </span>
                  <div
                    className={`w-full rounded-t-lg ${d.day === today ? "bg-accent" : "bg-[#bfdbfe]"}`}
                    style={{ height: `${Math.max(4, d.pct)}%` }}
                  />
                  <span className={`text-[11px] font-semibold ${picked === d.day ? "text-ink" : "text-muted-2"}`}>{d.label}</span>
                </button>
              ))}
            </div>
            {!breakdown && <p className="mt-2 text-center text-[11px] font-medium text-muted-2">Tap a bar for sales by category</p>}
          </div>
          {breakdown?.isDay && <CategoryBreakdown data={breakdown} onClose={() => setPicked(null)} />}

          <div className="mb-2.5 mt-6 flex items-baseline justify-between">
            <h2 className="text-[17px] font-bold">Monthly revenue</h2>
            <span className="tabular-nums text-xs font-semibold text-muted">{money(monthTotal)} / 6mo</span>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4 pb-2.5">
            <div className="flex h-[140px] items-end gap-2.5">
              {monthBars.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => togglePick(m.key)}
                  aria-pressed={picked === m.key}
                  className={`flex h-full flex-1 flex-col items-center justify-end gap-1.5 rounded-lg transition-opacity ${
                    picked && picked.length === 7 && picked !== m.key ? "opacity-45" : ""
                  }`}
                >
                  <span className="tabular-nums text-[11px] font-bold text-muted">
                    {m.total > 0 ? Math.round(m.total / 1000) + "k" : ""}
                  </span>
                  <div
                    className={`w-full rounded-t-lg ${m.isCurrent ? "bg-accent" : "bg-[#bfdbfe]"}`}
                    style={{ height: `${Math.max(4, m.pct)}%` }}
                  />
                  <span className={`text-[11px] font-semibold ${picked === m.key ? "text-ink" : "text-muted-2"}`}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
          {breakdown && !breakdown.isDay && <CategoryBreakdown data={breakdown} onClose={() => setPicked(null)} />}

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Cashiers today</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {cashiers.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted">No cashier accounts yet — add one from Users.</p>
            ) : (
              cashiers.map((c) => (
                <div key={c.uid} className="flex items-center gap-3 border-t border-[#f1f5f9] px-3.5 py-3 first:border-t-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-sm font-extrabold text-accent">
                    {initials(c.name)}
                  </div>
                  <div className="flex-1">
                    <div className="text-[15px] font-bold">{c.name}</div>
                    <div className="text-xs font-medium text-muted-2">Today</div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums text-[15px] font-bold">{money(c.takings)}</div>
                    <div className="tabular-nums text-xs font-medium text-muted-2">{c.bills} bills</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Needs attention</h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Nothing needs attention right now.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {alerts.map((a, i) => (
                <div key={i} className={`rounded-xl border border-border border-l-4 bg-surface px-3.5 py-3 ${a.mark}`}>
                  <div className="text-sm font-bold">{a.title}</div>
                  <div className="text-xs font-medium leading-relaxed text-muted">{a.body}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface Breakdown {
  title: string;
  total: number;
  bills: number;
  roundOff: number;
  categories: {
    id: string;
    name: string;
    color: string;
    cash: number;
    credit: number;
    total: number;
    products: { key: string; name: string; unit: string; qty: number; total: number }[];
  }[];
}

/** One day's or month's takings split by category, each with the products sold in it. */
function CategoryBreakdown({ data, onClose }: { data: Breakdown; onClose: () => void }) {
  const lineTotal = data.categories.reduce((s, c) => s + c.total, 0);
  const max = Math.max(1, ...data.categories.map((c) => c.total));
  return (
    <div className="mt-2.5 rounded-2xl border border-border bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="text-[15px] font-bold">{data.title}</div>
          <div className="tabular-nums text-xs font-medium text-muted">
            {money(data.total)} · {data.bills} bill{data.bills === 1 ? "" : "s"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-ground px-2.5 py-1 text-xs font-bold text-muted active:bg-border"
        >
          Close
        </button>
      </div>
      {data.categories.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted">No sales.</p>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {data.categories.map((c) => (
            <div key={c.id || c.name}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 font-bold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.name}
                </span>
                <span className="tabular-nums font-extrabold">
                  {money(c.total)}
                  <span className="ml-1.5 text-[11px] font-semibold text-muted">
                    {lineTotal > 0 ? Math.round((c.total / lineTotal) * 100) : 0}%
                  </span>
                </span>
              </div>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-ground">
                <div style={{ width: `${(c.cash / max) * 100}%`, backgroundColor: c.color }} />
                <div style={{ width: `${(c.credit / max) * 100}%`, backgroundColor: c.color, opacity: 0.4 }} />
              </div>
              <div className="tabular-nums mt-1 text-[11px] font-semibold text-muted">
                Cash {money(c.cash)} · Credit {money(c.credit)}
              </div>
              <div className="mt-2 flex flex-col gap-1 border-l-2 border-border pl-3">
                {c.products.map((p) => (
                  <div key={p.key} className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-medium">
                      {p.name}
                      <span className="tabular-nums ml-1.5 text-[11px] text-muted-2">
                        {p.qty} {p.unit}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold">{money(p.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {Math.abs(data.roundOff) >= 0.01 && (
            <div className="tabular-nums border-t border-border pt-2 text-[11px] font-semibold text-muted">
              Round-off on bills: {money(-data.roundOff)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
