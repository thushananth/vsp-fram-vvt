"use client";

import { useMemo, useState } from "react";
import { useAdminGate } from "@/components/AdminGate";
import { Search, TriangleAlert } from "lucide-react";
import { useBills } from "@/lib/firestore/bills";
import { useProducts } from "@/lib/firestore/products";
import ProductThumb from "@/components/ui/ProductThumb";
import Stat from "@/components/ui/Stat";
import { money, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import type { Product } from "@/lib/types";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

interface ProductProfit {
  productId: string;
  name: string;
  product: Product | undefined;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  /** True when any line fell back to the product's *current* cost price. */
  estimated: boolean;
}

/**
 * Margin, by product and in total. Admin-only, like every other place cost
 * price is shown.
 *
 * Profit is measured line by line against `costPrice` as it was **stamped on
 * the line at the moment of sale**. Reading cost off the product instead would
 * silently re-price last month's margin every time the bakery changes what it
 * charges. Bills written before that field existed fall back to the product's
 * current cost and are marked estimated, rather than counted as pure profit.
 */
export default function ProfitPage() {
  const gate = useAdminGate("Profit", "It shows what the shop pays for stock, so it stays off the till.");
  const today = todayKey();
  const { bills, loading } = useBills();
  const { products } = useProducts();

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [search, setSearch] = useState("");

  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const { rows, totals } = useMemo(() => {
    const byProduct = new Map<string, ProductProfit>();
    let revenue = 0;
    let cost = 0;
    let estimatedLines = 0;

    const inRange = bills.filter(
      (b) => b.status === "paid" && b.createdAt >= range.startMs && b.createdAt < range.endMs,
    );

    for (const bill of inRange) {
      for (const lineItem of bill.lines) {
        const product = productsById.get(lineItem.productId);
        const stamped = lineItem.costPrice;
        const unitCost = stamped ?? product?.costPrice ?? 0;
        const isEstimate = stamped === undefined;
        if (isEstimate) estimatedLines += 1;

        const lineRevenue = lineItem.price * lineItem.qty;
        const lineCost = unitCost * lineItem.qty;
        revenue += lineRevenue;
        cost += lineCost;

        const existing = byProduct.get(lineItem.productId);
        if (existing) {
          existing.qty += lineItem.qty;
          existing.revenue += lineRevenue;
          existing.cost += lineCost;
          existing.profit += lineRevenue - lineCost;
          existing.estimated = existing.estimated || isEstimate;
        } else {
          byProduct.set(lineItem.productId, {
            productId: lineItem.productId,
            name: lineItem.name,
            product,
            qty: lineItem.qty,
            revenue: lineRevenue,
            cost: lineCost,
            profit: lineRevenue - lineCost,
            estimated: isEstimate,
          });
        }
      }
    }

    return {
      rows: [...byProduct.values()].sort((a, b) => b.profit - a.profit),
      totals: { revenue, cost, profit: revenue - cost, bills: inRange.length, estimatedLines },
    };
  }, [bills, productsById, range]);

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

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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
          <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            <div className="w-11" />
            <div className="flex-1">Item</div>
            <div className="w-12 text-right">Qty</div>
            <div className="w-20 text-right">Revenue</div>
            <div className="w-20 text-right">Profit</div>
            <div className="w-14 text-right">Margin</div>
          </div>
          {visible.map((row) => {
            const margin = row.revenue > 0 ? Math.round((row.profit / row.revenue) * 100) : 0;
            return (
              <div
                key={row.productId}
                className="flex items-center gap-2 border-t border-[#f1f5f9] px-3.5 py-2.5"
              >
                <ProductThumb
                  name={row.name}
                  imageUrl={row.product?.imageUrl ?? null}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{row.name}</div>
                  <div className="tabular-nums text-[11px] font-medium text-muted-2">
                    cost {money(row.cost)}
                    {row.estimated && <span className="ml-1 text-warning">estimated</span>}
                  </div>
                </div>
                <div className="tabular-nums w-12 text-right text-sm font-bold">{row.qty}</div>
                <div className="tabular-nums w-20 text-right text-sm font-semibold">
                  {money(row.revenue)}
                </div>
                <div
                  className={`tabular-nums w-20 text-right text-[15px] font-extrabold ${
                    row.profit < 0 ? "text-danger" : "text-ink"
                  }`}
                >
                  {money(row.profit)}
                </div>
                <div
                  className={`tabular-nums w-14 text-right text-sm font-bold ${
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
