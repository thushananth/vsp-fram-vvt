"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, Search, X } from "lucide-react";
import { useProducts } from "@/lib/firestore/products";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { money } from "@/lib/format";
import { exportStockCsv, type StockReportRow } from "@/lib/exportStock";
import Splash from "@/components/Splash";

export default function StockReportPage() {
  const { products, loading } = useProducts();
  const { profile, loading: authLoading } = useAuth();
  const { permissions, loading: permissionsLoading } = usePermissions();
  const isAdmin = profile?.role === "admin";
  const canSeeCost = isAdmin;
  const [search, setSearch] = useState("");

  const rows: StockReportRow[] = useMemo(
    () =>
      products
        .map((p) => {
          const qty = p.onShelf ?? 0;
          const status = p.minLevel !== null && qty <= 0 ? "Low" : p.minLevel !== null && qty <= p.minLevel ? "Watch" : "OK";
          return {
            name: p.name,
            category: p.category,
            isBakery: p.isBakery,
            unit: p.unit,
            price: p.price,
            costPrice: p.costPrice,
            qty,
            minLevel: p.minLevel,
            maxLevel: p.maxLevel,
            status,
            expiryDate: p.expiryDate ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const q = search.trim().toLowerCase();
  const visibleRows = useMemo(
    () => rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)),
    [rows, q],
  );

  const totals = {
    items: rows.length,
    units: rows.reduce((t, r) => t + r.qty, 0),
    value: rows.reduce((t, r) => t + r.qty * r.price, 0),
    cost: rows.reduce((t, r) => t + r.qty * r.costPrice, 0),
    low: rows.filter((r) => r.status === "Low").length,
    watch: rows.filter((r) => r.status === "Watch").length,
  };

  if (authLoading || permissionsLoading) return <Splash />;
  if (!isAdmin && !permissions.viewStockReport) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-extrabold">Stock report is admin-only</h1>
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
          <h1 className="text-2xl font-extrabold tracking-tight">Stock report</h1>
          <p className="text-sm font-medium text-muted">Snapshot of every item, right now</p>
        </div>
        <button
          onClick={() => exportStockCsv(rows)}
          className="min-h-[44px] shrink-0 rounded-xl bg-accent px-3.5 text-sm font-bold text-white"
        >
          <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
          Export CSV
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Items</div>
              <div className="tabular-nums text-xl font-extrabold">{totals.items}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Units in stock</div>
              <div className="tabular-nums text-xl font-extrabold">{totals.units}</div>
            </div>
            <div className="rounded-xl border border-border bg-surface px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Stock value</div>
              <div className="tabular-nums text-lg font-extrabold">{money(totals.value)}</div>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-warning">Low / watch</div>
              <div className="tabular-nums text-lg font-extrabold text-warning">
                {totals.low} / {totals.watch}
              </div>
            </div>
          </div>
          {canSeeCost && (
            <p className="tabular-nums mt-2 text-xs font-semibold text-muted-2">
              Stock cost {money(totals.cost)} — margin {money(totals.value - totals.cost)}
            </p>
          )}

          <div className="relative mt-3.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by item or category"
              className="h-[46px] w-full rounded-xl border border-border bg-surface pl-10 pr-9 text-sm font-medium outline-none focus:border-accent"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-2"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-3.5 overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <div className="flex-1">Item</div>
              <div className="w-16 text-right">Qty</div>
              <div className="w-20 text-right">Value</div>
              <div className="w-16 text-right">Status</div>
            </div>
            {visibleRows.map((r) => (
              <div key={r.name} className="flex items-center gap-2 border-t border-[#f1f5f9] px-3.5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className="text-[11px] font-medium text-muted-2">{r.category}</div>
                </div>
                <div className="tabular-nums w-16 text-right font-bold">{r.qty}</div>
                <div className="tabular-nums w-20 text-right text-muted-2">{money(r.qty * r.price)}</div>
                <div className="w-16 text-right">
                  <span
                    className={`inline-block rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      r.status === "Low"
                        ? "bg-danger/10 text-danger"
                        : r.status === "Watch"
                          ? "bg-warning/10 text-warning"
                          : "bg-success/10 text-success"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
            {visibleRows.length === 0 && (
              <p className="p-6 text-center text-muted">No items match your search.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
