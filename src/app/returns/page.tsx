"use client";

import { useMemo, useState } from "react";
import { PackageX, Plus, Trash2 } from "lucide-react";
import { useReturns, logReturn, deleteReturn } from "@/lib/firestore/returns";
import { todayKey } from "@/lib/firestore/bakeryDays";
import { useProducts } from "@/lib/firestore/products";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import ProductPicker from "@/components/ProductPicker";
import ProductThumb from "@/components/ui/ProductThumb";
import Stat from "@/components/ui/Stat";
import { timeOfDay } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import type { Product, ReturnEntry } from "@/lib/types";

const REASONS: ReturnEntry["reason"][] = ["Unsold", "Damaged", "Stale"];

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

/**
 * What went back, viewable over any date range.
 *
 * It used to be a form at the bottom of Report whose product field was a
 * `<select>` of the whole catalogue — fine at ten products, unusable at three
 * hundred. Here the picker is a searchable sheet, and the list itself is
 * filtered by the same range picker Bills and Report use.
 */
export default function ReturnsPage() {
  const today = todayKey();

  const { products } = useProducts();
  const { profile } = useAuth();
  const { permissions } = usePermissions();
  const { returns: allReturns, loading } = useReturns();

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  const returns = useMemo(
    () => allReturns.filter((r) => r.createdAt >= range.startMs && r.createdAt < range.endMs),
    [allReturns, range],
  );

  const canLogReturns = profile?.role === "admin" || permissions.logReturns;

  const [logging, setLogging] = useState(false);
  const [deleting, setDeleting] = useState<ReturnEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteReturn(deleting.id);
      setDeleting(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  const productsById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // Bakery items are what actually come back, so they float to the top of
  // the picker — but any product can still be picked below them.
  const suggestedIds = useMemo(
    () => products.filter((p) => p.isBakery).map((p) => p.id),
    [products],
  );

  const totals = useMemo(() => {
    const byReason = new Map<string, number>(REASONS.map((r) => [r, 0]));
    let units = 0;
    let value = 0;
    for (const entry of returns) {
      units += entry.qty;
      byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + entry.qty);
      value += entry.qty * (productsById.get(entry.productId)?.price ?? 0);
    }
    return { units, value, byReason };
  }, [returns, productsById]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Returns</h1>
          <p className="text-sm font-medium text-muted">
            Items that went back — unsold, damaged or stale.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
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
        <div className="-mt-2 flex items-center gap-2">
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

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Units back" value={String(totals.units)} tone={totals.units ? "warning" : "default"} />
        <Stat
          label="At sale price"
          value={`Rs ${Math.round(totals.value).toLocaleString("en-LK")}`}
          note="what it would have sold for"
        />
        {REASONS.slice(0, 2).map((reason) => (
          <Stat key={reason} label={reason} value={String(totals.byReason.get(reason) ?? 0)} note="units" />
        ))}
      </div>

      {canLogReturns ? (
        <button
          onClick={() => setLogging(true)}
          className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-accent text-base font-bold text-white"
        >
          <Plus className="h-5 w-5" />
          Log a return
        </button>
      ) : (
        <p className="rounded-xl border border-border bg-surface px-3.5 py-3 text-xs font-medium text-muted-2">
          Logging returns isn&apos;t enabled for cashiers — an admin can turn this on in Settings.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-[17px] font-bold">
          {range.label}
          <span className="ml-2 text-sm font-semibold text-muted-2">
            {returns.length} {returns.length === 1 ? "entry" : "entries"}
          </span>
        </h2>

        {loading ? (
          <p className="py-8 text-center text-muted">Loading…</p>
        ) : returns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface py-10">
            <PackageX className="h-7 w-7 text-muted-2" />
            <p className="text-sm font-semibold text-muted">Nothing came back in this range.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {returns.map((entry) => {
              const product = productsById.get(entry.productId);
              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3"
                >
                  <ProductThumb
                    name={product?.name ?? "?"}
                    imageUrl={product?.imageUrl ?? null}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">
                      {product?.name ?? "Deleted item"}
                    </div>
                    <div className="text-[11px] font-medium text-muted-2">
                      {entry.date} · {timeOfDay(entry.createdAt)}
                    </div>
                  </div>
                  <span className="rounded-md bg-warning/10 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-warning">
                    {entry.reason}
                  </span>
                  <span className="tabular-nums w-10 text-right text-lg font-extrabold">
                    {entry.qty}
                  </span>
                  {canLogReturns && (
                    <button
                      onClick={() => { setDeleting(entry); setDeleteError(null); }}
                      aria-label="Delete return"
                      className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 p-2 text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {logging && profile && (
        <LogReturnSheet
          products={products}
          suggestedIds={suggestedIds}
          date={today}
          byUserId={profile.uid}
          onClose={() => setLogging(false)}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center">
          <div className="mx-auto w-full max-w-sm rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
            <h3 className="text-lg font-extrabold">Delete this return?</h3>
            <p className="mt-1.5 text-sm font-medium text-muted">
              {productsById.get(deleting.productId)?.name ?? "This item"} · {deleting.qty} ·{" "}
              {deleting.reason}. This cannot be undone.
            </p>
            {deleteError && (
              <p role="alert" className="mt-3 text-xs font-bold text-danger">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setDeleting(null); setDeleteError(null); }}
                disabled={deleteBusy}
                className="min-h-[48px] flex-1 rounded-xl border border-border text-sm font-bold text-muted disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
                className="min-h-[48px] flex-1 rounded-xl bg-danger text-sm font-bold text-white disabled:opacity-40"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pick the item, then the count and the reason — in that order, on one sheet. */
function LogReturnSheet({
  products,
  suggestedIds,
  date,
  byUserId,
  onClose,
}: {
  products: Product[];
  suggestedIds: string[];
  date: string;
  byUserId: string;
  onClose: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<ReturnEntry["reason"]>("Unsold");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyValue = Math.max(0, Number(qty) || 0);

  // No product chosen yet: the picker *is* the sheet, so choosing is one tap
  // rather than opening a modal on top of a modal.
  if (!product) {
    return (
      <ProductPicker
        products={products}
        suggestedIds={suggestedIds}
        suggestedLabel="Bakery items"
        title="What came back?"
        onPick={setProduct}
        onClose={onClose}
      />
    );
  }

  async function handleSave() {
    if (!product || qtyValue <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await logReturn({
        date,
        productId: product.id,
        name: product.name,
        qty: qtyValue,
        reason,
        byUserId,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb name={product.name} imageUrl={product.imageUrl} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-xl font-extrabold">{product.name}</div>
              <button
                onClick={() => setProduct(null)}
                className="text-sm font-bold text-accent underline"
              >
                Change item
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          How many came back
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setQty(String(Math.max(0, qtyValue - 1)))}
            className="h-[54px] w-[54px] rounded-2xl border border-border text-2xl font-bold"
          >
            −
          </button>
          <input
            autoFocus
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="numeric"
            aria-label="Quantity returned"
            className="tabular-nums h-[54px] flex-1 rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground text-center text-2xl font-extrabold text-ink outline-none focus:border-accent"
          />
          <button
            onClick={() => setQty(String(qtyValue + 1))}
            className="h-[54px] w-[54px] rounded-2xl bg-accent text-2xl font-bold text-white"
          >
            +
          </button>
        </div>

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Why
        </div>
        <div className="flex gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`min-h-[46px] flex-1 rounded-xl border text-sm font-bold ${
                reason === r ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm font-bold text-danger">
            {error}
          </p>
        )}

        <button
          onClick={() => void handleSave()}
          disabled={saving || qtyValue <= 0}
          className="mt-4 min-h-[54px] w-full rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : `Log ${qtyValue} back`}
        </button>
      </div>
    </div>
  );
}
