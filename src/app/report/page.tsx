"use client";

import { useMemo, useState } from "react";
import { useBills } from "@/lib/firestore/bills";
import { todayKey } from "@/lib/firestore/farmDays";
import { useAuth } from "@/lib/auth";
import Stat from "@/components/ui/Stat";
import { money } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";

interface StockSaleRow {
  productId: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
}

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

export default function ReportPage() {
  const today = todayKey();
  const { bills, loading: billsLoading } = useBills();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [stockSort, setStockSort] = useState<"qty" | "profit">("qty");

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  const rangeBills = useMemo(
    () => bills.filter((b) => b.createdAt >= range.startMs && b.createdAt < range.endMs),
    [bills, range],
  );
  const paidBills = rangeBills.filter((b) => b.status === "paid");
  const salesTotal = paidBills.reduce((sum, b) => sum + b.total, 0);
  const unsyncedCount = rangeBills.filter((b) => !b.synced).length;

  const stats = [
    { label: "Sales", value: money(salesTotal), note: `${paidBills.length} bills`, color: "text-muted" },
    {
      label: "Bills",
      value: String(rangeBills.length),
      note: `${paidBills.length} paid · ${rangeBills.length - paidBills.length} void`,
      color: "text-muted",
    },
    {
      label: "Avg bill",
      value: money(paidBills.length ? Math.round(salesTotal / paidBills.length) : 0),
      note: "Cash only",
      color: "text-muted",
    },
    {
      label: "Unsynced",
      value: String(unsyncedCount),
      note: unsyncedCount ? "needs sync" : "all synced",
      color: unsyncedCount ? "text-warning" : "text-success",
    },
  ];

  const isSingleDay = !!range.singleDayKey;

  // Single day → sales by hour (12 hourly buckets). Multi-day → sales by
  // calendar day across the range instead.
  const chartBars = useMemo(() => {
    if (isSingleDay) {
      const buckets = Array.from({ length: 12 }, (_, i) => ({ key: String(i + 8), label: `${i + 8}h`, total: 0 }));
      for (const b of paidBills) {
        const hour = new Date(b.createdAt).getHours();
        const bucket = buckets.find((x) => x.key === String(hour));
        if (bucket) bucket.total += b.total;
      }
      const max = Math.max(1, ...buckets.map((b) => b.total));
      return buckets.map((b) => ({ ...b, pct: Math.round((b.total / max) * 100) }));
    }
    const byDay = new Map<string, number>();
    for (const b of paidBills) {
      const key = new Date(b.createdAt).toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + b.total);
    }
    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(1, ...days.map(([, total]) => total));
    return days.map(([key, total]) => ({
      key,
      label: new Date(key).getDate().toString(),
      total,
      pct: Math.round((total / max) * 100),
    }));
  }, [paidBills, isSingleDay]);

  // Units moved per product, in this range — the fast movers and (for
  // admins) the ones actually worth the shelf space.
  const stockSales = useMemo(() => {
    const map = new Map<string, StockSaleRow>();
    for (const b of paidBills) {
      for (const l of b.lines) {
        const cur = map.get(l.productId) ?? { productId: l.productId, name: l.name, qty: 0, revenue: 0, cost: 0 };
        cur.qty += l.qty;
        cur.revenue += l.price * l.qty;
        cur.cost += (l.costPrice ?? 0) * l.qty;
        map.set(l.productId, cur);
      }
    }
    const rows = [...map.values()];
    rows.sort((a, b) =>
      stockSort === "qty" ? b.qty - a.qty : b.revenue - b.cost - (a.revenue - a.cost),
    );
    return rows;
  }, [paidBills, stockSort]);

  const loading = billsLoading;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Sales report</h1>
          <p className="text-sm font-medium text-muted">{range.label}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.mode}
            onClick={() => setRangeMode(o.mode)}
            className={`min-h-[40px] flex-1 rounded-lg px-2 text-[13px] font-bold ${
              rangeMode === o.mode ? "bg-white shadow-sm" : "text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {rangeMode === "custom" && (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium"
          />
          <span className="text-sm font-semibold text-muted">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium"
          />
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} note={s.note} noteColor={s.color} />
            ))}
          </div>

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">
            {isSingleDay ? "Sales by hour" : "Sales by day"}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface p-4 pb-2.5">
            {chartBars.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No sales in this range.</p>
            ) : (
              <div className="flex h-[150px] min-w-full items-end gap-1.5">
                {chartBars.map((h) => (
                  <div key={h.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                    <div className="w-full rounded-t-md bg-accent" style={{ height: `${Math.max(4, h.pct)}%` }} />
                    <div className="tabular-nums text-[10px] font-semibold text-muted-2">{h.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-2.5 mt-6 flex items-center justify-between gap-3">
            <h2 className="text-[17px] font-bold">Stock sales — units moved</h2>
            <div className="flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
              <button
                onClick={() => setStockSort("qty")}
                className={`min-h-[34px] rounded-lg px-2.5 text-[12px] font-bold ${
                  stockSort === "qty" ? "bg-white shadow-sm" : "text-muted"
                }`}
              >
                Most sold
              </button>
              {isAdmin && (
                <button
                  onClick={() => setStockSort("profit")}
                  className={`min-h-[34px] rounded-lg px-2.5 text-[12px] font-bold ${
                    stockSort === "profit" ? "bg-white shadow-sm" : "text-muted"
                  }`}
                >
                  Most profit
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-ground text-[10px] font-bold uppercase tracking-wider text-muted">
                  <th className="px-3.5 py-2.5 text-left">Item</th>
                  <th className="px-3.5 py-2.5 text-right">Units sold</th>
                  <th className="px-3.5 py-2.5 text-right">Revenue</th>
                  {isAdmin && <th className="px-3.5 py-2.5 text-right">Cost</th>}
                  {isAdmin && <th className="px-3.5 py-2.5 text-right">Profit</th>}
                </tr>
              </thead>
              <tbody>
                {stockSales.map((r) => (
                  <tr key={r.productId} className="border-t border-[#f1f5f9]">
                    <td className="max-w-[180px] truncate px-3.5 py-2.5 font-semibold">{r.name}</td>
                    <td className="tabular-nums px-3.5 py-2.5 text-right font-bold">{r.qty}</td>
                    <td className="tabular-nums px-3.5 py-2.5 text-right text-muted-2">{money(r.revenue)}</td>
                    {isAdmin && (
                      <td className="tabular-nums px-3.5 py-2.5 text-right text-muted-2">{money(r.cost)}</td>
                    )}
                    {isAdmin && (
                      <td className="tabular-nums px-3.5 py-2.5 text-right font-bold text-success">
                        {money(r.revenue - r.cost)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {stockSales.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">No sales in this range.</p>
            )}
          </div>
        </>
      )}

    </div>
  );
}
