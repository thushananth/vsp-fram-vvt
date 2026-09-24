"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useStockHistory } from "@/lib/firestore/stockHistory";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { money, dateAndTime } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import { todayKey } from "@/lib/firestore/bakeryDays";
import Splash from "@/components/Splash";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

/**
 * What was bought in, not what was sold. Sales already live in Bills and the
 * Report's "Stock sales" table — mixing the two here would make "added" and
 * "sold" look like the same kind of number when they never are.
 */
export default function StockHistoryPage() {
  const today = todayKey();
  const { history, loading } = useStockHistory();
  const { profile, loading: authLoading } = useAuth();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const isAdmin = profile?.role === "admin";

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  const rows = useMemo(
    () => history.filter((h) => h.createdAt >= range.startMs && h.createdAt < range.endMs),
    [history, range],
  );

  const totals = {
    entries: rows.length,
    units: rows.reduce((sum, r) => sum + r.qty, 0),
    cost: rows.reduce((sum, r) => sum + r.qty * r.costPrice, 0),
  };

  if (authLoading || permissionsLoading) return <Splash />;
  if (!isAdmin && !permissions.viewStockReport) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-extrabold">Stock history is admin-only</h1>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
          An admin can turn this on for cashiers in Settings.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-center gap-2">
        <Link
          href="/stock"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface"
          aria-label="Back to stock"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">Stock history</h1>
          <p className="text-sm font-medium text-muted">
            Purchases only — stock taken in, not sold.
          </p>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
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
          <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Entries</div>
              <div className="tabular-nums text-xl font-extrabold">{totals.entries}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Units bought in</div>
              <div className="tabular-nums text-xl font-extrabold">{totals.units}</div>
            </div>
            {isAdmin && (
              <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Cost spent</div>
                <div className="tabular-nums text-lg font-extrabold">{money(totals.cost)}</div>
              </div>
            )}
          </div>

          <div className="mt-3.5 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <div className="flex-1">Item</div>
              <div className="w-16 text-right">Qty</div>
              {isAdmin && <div className="w-20 text-right">Cost</div>}
              <div className="w-28 text-right">When</div>
            </div>
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 border-t border-[#f1f5f9] px-3.5 py-3 text-sm">
                <div className="min-w-0 flex-1 truncate font-semibold">{r.name}</div>
                <div className="tabular-nums w-16 text-right font-bold">+{r.qty}</div>
                {isAdmin && (
                  <div className="tabular-nums w-20 text-right text-muted-2">{money(r.qty * r.costPrice)}</div>
                )}
                <div className="w-28 text-right text-[11px] font-medium text-muted-2">
                  {dateAndTime(r.createdAt)}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="p-6 text-center text-muted">No stock was added in this range.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
