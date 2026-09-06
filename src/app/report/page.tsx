"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useBills } from "@/lib/firestore/bills";
import { useBakeryDay, todayKey } from "@/lib/firestore/bakeryDays";
import Stat from "@/components/ui/Stat";
import { money } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";

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

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  // Bakery reconciliation + return log are keyed by a single day — for a
  // multi-day range we still need to call these hooks, so fall back to
  // today's key and simply don't render the sections.
  const { items: bakeryItems, loading: bakeryLoading } = useBakeryDay(range.singleDayKey ?? today);


  const rangeBills = useMemo(
    () => bills.filter((b) => b.createdAt >= range.startMs && b.createdAt < range.endMs),
    [bills, range],
  );
  const paidBills = rangeBills.filter((b) => b.status === "paid");
  const salesTotal = paidBills.reduce((sum, b) => sum + b.total, 0);
  const bakerySoldQty = bakeryItems.reduce((sum, i) => sum + i.sold, 0);
  const bakeryReturnedQty = bakeryItems.reduce((sum, i) => sum + i.returned, 0);
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
      label: "Bakery sold",
      value: range.singleDayKey ? String(bakerySoldQty) : "—",
      note: range.singleDayKey ? "units" : "single day only",
      color: "text-muted",
    },
    {
      label: "Returns",
      value: range.singleDayKey ? String(bakeryReturnedQty) : "—",
      note: range.singleDayKey ? "units" : "single day only",
      color: "text-warning",
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


  const loading = billsLoading || (isSingleDay && bakeryLoading);

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Sales report</h1>
          <p className="text-sm font-medium text-muted">{range.label}</p>
        </div>
        {/* Returns have their own screen now — this is just the way through. */}
        <Link
          href="/returns"
          className="min-h-[46px] shrink-0 rounded-xl border border-warning/30 bg-warning/10 px-4 text-sm font-bold leading-[46px] text-warning"
        >
          Returns →
        </Link>
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

          {isSingleDay && (
            <>
              <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Bakery items — in, sold, returned</h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                  <div className="flex-1">Item</div>
                  <div className="w-14 text-right">In</div>
                  <div className="w-14 text-right">Sold</div>
                  <div className="w-16 text-right">Return</div>
                </div>
                {bakeryItems.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted">No bakery intake recorded this day.</p>
                ) : (
                  bakeryItems.map((b) => (
                    <div key={b.productId} className="flex items-center gap-2 border-t border-[#f1f5f9] px-3.5 py-2.5">
                      <div className="flex-1 text-sm font-semibold">{b.name}</div>
                      <div className="tabular-nums w-14 text-right text-sm font-medium text-muted">{b.received}</div>
                      <div className="tabular-nums w-14 text-right text-sm font-bold">{b.sold}</div>
                      <div className="tabular-nums w-16 text-right text-sm font-bold text-warning">{b.returned}</div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

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

        </>
      )}

    </div>
  );
}
