"use client";

import { useMemo, useState } from "react";
import { buildProfit } from "@/lib/profit";
import { useAdminGate } from "@/components/AdminGate";
import { Search, TriangleAlert } from "lucide-react";
import { useBills } from "@/lib/firestore/bills";
import { useProducts } from "@/lib/firestore/products";
import ProductThumb from "@/components/ui/ProductThumb";
import Stat from "@/components/ui/Stat";
import { money, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

/** Thumb · item · qty · revenue · profit · margin (qty and revenue hidden on a phone). */
const ROW_GRID =
  "grid items-center gap-x-3 grid-cols-[2.75rem_minmax(0,1fr)_auto_3rem] sm:grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_7.5rem_7rem_3.5rem]";

/** Weighed quantities add up to float noise (773.4710000001) — show at most 3 decimals. */
function qtyText(qty: number): string {
  return qty.toLocaleString("en-LK", { maximumFractionDigits: 3 });
}

/** Margin, by product and in total. Admin-only, like every other place cost
 * price is shown. The maths lives in buildProfit (src/lib/profit.ts). */
export default function ProfitPage() {
  const gate = useAdminGate("Profit", "It shows what the shop pays for stock, so it stays off the till.");
  const today = todayKey();
  const { products } = useProducts();

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [search, setSearch] = useState("");

  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const { bills, loading } = useBills(range);

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const { rows, totals } = useMemo(
    () => buildProfit({ bills, productsById, startMs: range.startMs, endMs: range.endMs }),
    [bills, productsById, range],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, search]);

  const marginPct = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : 0;
  const best = rows[0];
  // A negative-profit line is usually a cost price that was never filled in,
  // or a discount below cost — either way the shop wants to see it.
  const losers = rows.filter((r) => r.profit < 0);



  // Denied by default until the profile says otherwise.
  if (gate) return gate;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Profit</h1>
        <p className="text-sm font-medium text-muted">
          What was sold, what it cost, and what was left — {range.label.toLowerCase()}.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            onClick={() => setRangeMode(option.mode)}
            className={`min-h-[40px] rounded-xl px-3.5 text-[13px] font-bold ${
              rangeMode === option.mode
                ? "bg-accent text-white"
                : "border border-border bg-surface text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {rangeMode === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label="From date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
          <span className="text-sm font-bold text-muted-2">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label="To date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Two by two on a portrait tablet: four across leaves too little room for a seven-figure total. */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Revenue" value={money(totals.revenue)} note={`${totals.bills} bills`} />
        <Stat label="Cost of goods" value={money(totals.cost)} />
        <Stat
          label="Profit"
          value={money(totals.profit)}
          note={`${marginPct}% margin`}
          noteColor={totals.profit >= 0 ? "text-success" : "text-danger"}
          tone={totals.profit < 0 ? "warning" : "default"}
        />
        <Stat
          label="Best earner"
          value={best ? money(best.profit) : "—"}
          note={best?.name ?? "nothing sold yet"}
        />
      </div>

      {totals.estimatedLines > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3 text-xs font-semibold text-warning">
          <TriangleAlert className="mt-px h-4 w-4 shrink-0" />
          <span>
            {totals.estimatedLines} line{totals.estimatedLines === 1 ? "" : "s"} in this range were
            sold before cost was recorded on the bill. Their margin is estimated from the
            product&apos;s cost price <em>today</em>, so it moves if you change that price.
          </span>
        </p>
      )}

      {losers.length > 0 && (
        <p className="rounded-xl border border-danger/25 bg-danger/5 px-3.5 py-3 text-xs font-semibold text-danger">
          {losers.length} item{losers.length === 1 ? "" : "s"} sold at a loss —{" "}
          {losers
            .slice(0, 3)
            .map((r) => r.name)
            .join(", ")}
          {losers.length > 3 ? "…" : ""}. Usually a missing cost price in Stock.
        </p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find an item"
          aria-label="Search items"
          className="w-full rounded-xl border border-border bg-surface py-3 pl-11 pr-3.5 text-base outline-none focus:border-accent"
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-muted">
          {search ? `Nothing matches “${search.trim()}”.` : "Nothing sold in this range."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {/* One grid for header and rows, so every column lines up. On a phone,
              Qty and Revenue move under the item name; from tablet width up
              they get their own columns, sized for six-figure amounts. */}
          <div className={`${ROW_GRID} bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted`}>
            <div />
            <div>Item</div>
            <div className="hidden text-right sm:block">Qty</div>
            <div className="hidden text-right sm:block">Revenue</div>
            <div className="text-right">Profit</div>
            <div className="text-right">Margin</div>
          </div>
          {visible.map((row) => {
            const margin = row.revenue > 0 ? Math.round((row.profit / row.revenue) * 100) : 0;
            const unit = row.product?.unit ?? "";
            return (
              <div key={row.productId} className={`${ROW_GRID} border-t border-[#f1f5f9] px-3.5 py-2.5`}>
                <ProductThumb name={row.name} imageUrl={row.product?.imageUrl ?? null} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold">{row.name}</div>
                  <div className="tabular-nums truncate text-[11px] font-medium text-muted-2">
                    <span className="sm:hidden">
                      {qtyText(row.qty)} {unit} · {money(row.revenue)} ·{" "}
                    </span>
                    cost {money(row.cost)}
                    {row.estimated && <span className="ml-1 text-warning">estimated</span>}
                  </div>
                </div>
                <div className="tabular-nums hidden whitespace-nowrap text-right text-sm font-bold sm:block">
                  {qtyText(row.qty)}
                  {unit && <span className="ml-0.5 text-[11px] font-semibold text-muted-2">{unit}</span>}
                </div>
                <div className="tabular-nums hidden whitespace-nowrap text-right text-sm font-semibold sm:block">
                  {money(row.revenue)}
                </div>
                <div
                  className={`tabular-nums whitespace-nowrap text-right text-[15px] font-extrabold ${
                    row.profit < 0 ? "text-danger" : "text-ink"
                  }`}
                >
                  {money(row.profit)}
                </div>
                <div
                  className={`tabular-nums whitespace-nowrap text-right text-sm font-bold ${
                    row.profit < 0 ? "text-danger" : "text-muted"
                  }`}
                >
                  {margin}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
