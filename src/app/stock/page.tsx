"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, X, FileDown } from "lucide-react";
import {
  useProducts,
  createProduct,
  setProductImage,
  PRODUCT_UNITS,
} from "@/lib/firestore/products";
import { updateGoodsStock } from "@/lib/firestore/farmDays";
import { logStockPurchase } from "@/lib/firestore/stockHistory";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { money } from "@/lib/format";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import type { Product } from "@/lib/types";
import ProductThumb from "@/components/ui/ProductThumb";
import ProductImageField from "@/components/ProductImageField";
import { deleteProductImage, uploadProductImage } from "@/lib/productImages";

type Tab = "Farm Products" | "Barcoded goods";

export default function StockPage() {
  const { products, loading } = useProducts();
  const { profile } = useAuth();
  const { permissions } = usePermissions();
  const [tab, setTab] = useState<Tab>("Farm Products");
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const isAdmin = profile?.role === "admin";
  const canCreateItems = isAdmin || permissions.createStockItems;
  const canEditPrices = isAdmin || permissions.editStockPrices;
  const canViewStockReport = isAdmin || permissions.viewStockReport;
  const canAddStock = isAdmin || permissions.addStock;

  const q = search.trim().toLowerCase();

  const bakeryProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.isBakery &&
        (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)),
    );
  }, [products, q]);
  const goodsProducts = useMemo(() => {
    return products.filter(
      (p) =>
        !p.isBakery &&
        (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)),
    );
  }, [products, q]);

  const now = Date.now();
  function toRow(p: Product) {
    const qty = p.onShelf ?? 0;
    const min = p.minLevel;
    const expSoon = p.expiryDate && new Date(p.expiryDate).getTime() - now < 30 * 24 * 3600 * 1000;
    const status = min !== null && qty <= 0 ? "Low" : min !== null && qty <= min ? "Watch" : "OK";
    return { product: p, qty, status, expSoon };
  }

  const bakeryRows = bakeryProducts.map(toRow);
  const goodsRows = goodsProducts.map(toRow);
  const rows = tab === "Farm Products" ? bakeryRows : goodsRows;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Stock</h1>
          <p className="text-sm font-medium text-muted">Price, quantity and expiry</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canViewStockReport && (
            <Link
              href="/stock/history"
              className="flex min-h-[46px] items-center rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted"
            >
              History
            </Link>
          )}
          {canViewStockReport && (
            <Link
              href="/stock/report"
              className="flex min-h-[46px] items-center rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted"
            >
              <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
              Report
            </Link>
          )}
          {canCreateItems && (
            <button
              onClick={() => setCreating(true)}
              className="min-h-[46px] rounded-xl bg-accent px-4 text-sm font-bold text-white"
            >
              + New item
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {(["Farm Products", "Barcoded goods"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm font-bold ${
              tab === t ? "bg-white shadow-sm" : "text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by item, category or barcode"
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

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-3.5">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex gap-2.5 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <div className="w-11" />
              <div className="flex-1">Item</div>
              <div className="w-20 text-right">Price</div>
              <div className="w-16 text-right">In stock</div>
              <div className="w-16 text-right">Status</div>
            </div>
            {rows.map((row) => (
              <div
                key={row.product.id}
                className="flex min-h-[66px] items-center gap-2.5 border-t border-[#f1f5f9] px-3.5 py-3"
              >
                <button
                  onClick={() => setEditing(row.product)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <ProductThumb name={row.product.name} imageUrl={row.product.imageUrl} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">{row.product.name}</div>
                    {row.product.expiryDate && (
                      <div className={`text-[11px] font-medium ${row.expSoon ? "text-warning" : "text-muted-2"}`}>
                        Exp {row.product.expiryDate}
                      </div>
                    )}
                  </div>
                  <div className="tabular-nums w-20 text-right text-sm font-bold">{money(row.product.price)}</div>
                  <div className="tabular-nums w-16 text-right text-[15px] font-extrabold">{row.qty}</div>
                  <div className="w-16 text-right">
                    <span
                      className={`inline-block rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        row.status === "Low"
                          ? "bg-danger/10 text-danger"
                          : row.status === "Watch"
                            ? "bg-warning/10 text-warning"
                            : "bg-success/10 text-success"
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                </button>
                {canAddStock && (
                  <button
                    onClick={() => setAdding(row.product)}
                    className="shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-2 text-[11px] font-bold text-accent"
                  >
                    + Stock
                  </button>
                )}
              </div>
            ))}
            {rows.length === 0 && (
              <p className="p-6 text-center text-muted">
                {q
                  ? "No items match your search."
                  : `No ${tab === "Farm Products" ? "farm products" : "barcoded goods"} yet${
                      canCreateItems ? " — tap + New item to add one." : "."
                    }`}
              </p>
            )}
          </div>
        </div>
      )}

      {editing && (
        <StockEditSheet
          product={editing}
          canEditPrice={canEditPrices}
          canAddStock={canAddStock}
          canSeeCost={isAdmin}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && canAddStock && (
        <AddStockSheet product={adding} onClose={() => setAdding(null)} />
      )}

      {creating && (
        <NewItemSheet
          defaultIsBakery={tab === "Farm Products"}
          canSeeCost={isAdmin}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function NewItemSheet({
  defaultIsBakery,
  canSeeCost,
  onClose,
}: {
  defaultIsBakery: boolean;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const [isBakery, setIsBakery] = useState(defaultIsBakery);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [costPrice, setCostPrice] = useState(0);
  const [unit, setUnit] = useState<string>("pieces");
  const [category, setCategory] = useState<string>(defaultIsBakery ? "Whole Chicken" : "Feed");
  const [barcode, setBarcode] = useState("");
  const [minLevel, setMinLevel] = useState("");
  const [maxLevel, setMaxLevel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The photo can't be uploaded until the product has an id, so it is held
  // here and previewed from an object URL until Create runs. File and URL move
  // together in one state update — deriving the URL during render would mint a
  // new one on every keystroke elsewhere in the form.
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const previewUrl = useRef<string | null>(null);

  function pickPhoto(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = file ? URL.createObjectURL(file) : null;
    setPhoto(file && previewUrl.current ? { file, url: previewUrl.current } : null);
  }

  // Release the last preview when the sheet closes.
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const productId = await createProduct({
        name: name.trim(),
        price,
        costPrice,
        unit,
        category,
        isBakery,
        barcode: barcode.trim() || null,
        minLevel: minLevel === "" ? null : Number(minLevel),
        maxLevel: maxLevel === "" ? null : Number(maxLevel),
        imageUrl: null,
      });
      if (photo) {
        // The item exists either way: a failed upload loses the picture, not
        // the product the shop just typed in.
        try {
          await setProductImage(productId, await uploadProductImage(productId, photo.file));
        } catch (err) {
          setError(`Item created, but the photo didn't upload (${(err as Error).message})`);
          setSaving(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <form
        onSubmit={handleSave}
        className="mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-3xl bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-extrabold">New item</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <div className="flex gap-1.5 rounded-xl bg-ground p-1">
          <button
            type="button"
            onClick={() => setIsBakery(true)}
            className={`min-h-[42px] flex-1 rounded-lg text-sm font-bold ${isBakery ? "bg-white shadow-sm" : "text-muted"}`}
          >
            Farm Products
          </button>
          <button
            type="button"
            onClick={() => setIsBakery(false)}
            className={`min-h-[42px] flex-1 rounded-lg text-sm font-bold ${!isBakery ? "bg-white shadow-sm" : "text-muted"}`}
          >
            Barcoded good
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Price
            <input
              required
              value={price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
              inputMode="decimal"
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {canSeeCost ? (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Cost price
              <input
                value={costPrice}
                onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value) || 0))}
                inputMode="decimal"
                className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
              />
            </label>
          ) : (
            <div />
          )}
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Unit
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
            >
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>

        {canSeeCost && costPrice > 0 && (
          <p className="tabular-nums text-xs font-semibold text-muted-2">
            Margin {money(price - costPrice)} each
            {price > 0 && ` — ${Math.round(((price - costPrice) / price) * 100)}%`}
          </p>
        )}

        {!isBakery && (
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Barcode
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Scan or type the barcode"
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
            />
          </label>
        )}

        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Min &amp; max
          <span className="rounded-md bg-ground px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-muted">
            Optional
          </span>
        </div>
        <div className="flex gap-2.5">
          <input
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
            placeholder="Min"
            inputMode="numeric"
            className="h-[46px] flex-1 rounded-xl border border-border bg-ground px-3 text-base font-normal outline-none focus:border-accent"
          />
          <input
            value={maxLevel}
            onChange={(e) => setMaxLevel(e.target.value)}
            placeholder="Max"
            inputMode="numeric"
            className="h-[46px] flex-1 rounded-xl border border-border bg-ground px-3 text-base font-normal outline-none focus:border-accent"
          />
        </div>

        <ProductImageField
          name={name || "New item"}
          imageUrl={photo?.url ?? null}
          busy={saving && photo !== null}
          error={null}
          onPick={(file) => pickPhoto(file)}
          onRemove={() => pickPhoto(null)}
        />

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-2 min-h-[52px] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create item"}
        </button>
        <p className="text-xs font-medium text-muted-2">
          New items start at 0 stock — use the item&apos;s row afterwards to add stock.
        </p>
      </form>
    </div>
  );
}

/**
 * The fast path for "a delivery came in" — available quantity and how much
 * to add, nothing else. Price, cost, expiry and min/max stay whatever they
 * already were; StockEditSheet is still where those get changed.
 */
function AddStockSheet({ product, onClose }: { product: Product; onClose: () => void }) {
  const { profile, user } = useAuth();
  const available = product.onShelf ?? 0;
  const [addAmount, setAddAmount] = useState(0);
  const [saving, setSaving] = useState(false);
  const newTotal = available + addAmount;
  const chips = [5, 10, 20, 40];

  async function handleSave() {
    setSaving(true);
    try {
      await updateGoodsStock({
        product,
        qty: newTotal,
        price: product.price,
        costPrice: product.costPrice,
        expiryDate: product.expiryDate,
        minLevel: product.minLevel,
        maxLevel: product.maxLevel,
      });
      if (addAmount > 0) {
        await logStockPurchase({
          productId: product.id,
          name: product.name,
          qty: addAmount,
          price: product.price,
          costPrice: product.costPrice,
          byUserId: profile?.uid ?? user?.uid ?? "",
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold">{product.name}</h3>
            <p className="text-sm font-medium text-muted">Add stock</p>
          </div>
          <button onClick={onClose} className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted">
            Close
          </button>
        </div>

        <div className="mt-1 flex items-center justify-between rounded-xl bg-ground px-3.5 py-3">
          <span className="text-sm font-semibold text-muted">Available now</span>
          <span className="tabular-nums text-lg font-extrabold">{available}</span>
        </div>

        <div className="mb-2 mt-2 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Add stock
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setAddAmount((q) => Math.max(0, q - 1))}
            className="h-[54px] w-[54px] rounded-2xl border border-border text-2xl font-bold"
          >
            −
          </button>
          <input
            value={addAmount}
            onChange={(e) => setAddAmount(Math.max(0, Number(e.target.value) || 0))}
            inputMode="numeric"
            className="tabular-nums h-[54px] flex-1 rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground text-center text-2xl font-extrabold text-ink"
          />
          <button
            onClick={() => setAddAmount((q) => q + 1)}
            className="h-[54px] w-[54px] rounded-2xl bg-accent text-2xl font-bold text-white"
          >
            +
          </button>
        </div>
        <div className="flex gap-2">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setAddAmount((q) => q + c)}
              className="tabular-nums flex-1 min-h-[42px] rounded-xl border border-border text-sm font-bold text-muted"
            >
              +{c}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl bg-accent/5 px-3.5 py-3">
          <span className="text-sm font-semibold text-accent">New total</span>
          <span className="tabular-nums text-lg font-extrabold text-accent">{newTotal}</span>
        </div>

        <button
          onClick={() => void handleSave()}
          disabled={saving || addAmount <= 0}
          className="mt-2 min-h-[52px] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : `Add ${addAmount || ""} to stock`}
        </button>
      </div>
    </div>
  );
}

function StockEditSheet({
  product,
  canEditPrice,
  canAddStock,
  canSeeCost,
  onClose,
}: {
  product: Product;
  canEditPrice: boolean;
  canAddStock: boolean;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const { profile, user } = useAuth();
  // "Available" is what's already on the books; the user only types how
  // much they're ADDING — the new total is available + add, never typed
  // directly, so a cashier can't accidentally overwrite the real count.
  const available = product.onShelf ?? 0;
  const [addAmount, setAddAmount] = useState(0);
  const [price, setPrice] = useState(product.lastPrice || product.price);
  const [costPrice, setCostPrice] = useState(product.costPrice);
  const [expiryDate, setExpiryDate] = useState(product.expiryDate ?? "");
  const [minLevel, setMinLevel] = useState<string>(product.minLevel?.toString() ?? "");
  const [maxLevel, setMaxLevel] = useState<string>(product.maxLevel?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const chips = [5, 10, 20, 40];

  /**
   * The photo saves on its own, the moment it is chosen — it has nothing to do
   * with the intake figures below, and making it wait for Save would mean a
   * cancelled sheet silently discarded the upload that already happened.
   */
  async function handlePhoto(file: File) {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const url = await uploadProductImage(product.id, file);
      await setProductImage(product.id, url);
      if (product.imageUrl) void deleteProductImage(product.imageUrl);
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      await setProductImage(product.id, null);
      if (product.imageUrl) void deleteProductImage(product.imageUrl);
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }
  const newTotal = available + (canAddStock ? addAmount : 0);
  const intakeValue = (canAddStock ? addAmount : 0) * price;
  const intakeCost = (canAddStock ? addAmount : 0) * costPrice;
  const margin = price - costPrice;

  async function handleSave() {
    setSaving(true);
    try {
      const min = minLevel === "" ? null : Number(minLevel);
      const max = maxLevel === "" ? null : Number(maxLevel);
      await updateGoodsStock({
        product,
        qty: newTotal,
        price,
        costPrice,
        expiryDate: expiryDate || null,
        minLevel: min,
        maxLevel: max,
      });
      if (canAddStock && addAmount > 0) {
        await logStockPurchase({
          productId: product.id,
          name: product.name,
          qty: addAmount,
          price,
          costPrice,
          byUserId: profile?.uid ?? user?.uid ?? "",
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-extrabold">{product.name}</div>
            <div className="text-sm font-medium text-muted">Price & stock</div>
          </div>
          <button onClick={onClose} className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted">
            Close
          </button>
        </div>

        <div className="mt-4">
          <ProductImageField
            name={product.name}
            imageUrl={product.imageUrl}
            busy={photoBusy}
            error={photoError}
            onPick={(file) => void handlePhoto(file)}
            onRemove={() => void handleRemovePhoto()}
          />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-ground px-3.5 py-3">
          <span className="text-sm font-semibold text-muted">Available now</span>
          <span className="tabular-nums text-lg font-extrabold">{available}</span>
        </div>

        {canAddStock ? (
          <>
            <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
              Add stock
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setAddAmount((q) => Math.max(0, q - 1))}
                className="h-[54px] w-[54px] rounded-2xl border border-border text-2xl font-bold"
              >
                −
              </button>
              <input
                value={addAmount}
                onChange={(e) => setAddAmount(Math.max(0, Number(e.target.value) || 0))}
                inputMode="numeric"
                className="tabular-nums h-[54px] flex-1 rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground text-center text-2xl font-extrabold text-ink"
              />
              <button
                type="button"
                onClick={() => setAddAmount((q) => q + 1)}
                className="h-[54px] w-[54px] rounded-2xl bg-accent text-2xl font-bold text-white"
              >
                +
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAddAmount((q) => q + c)}
                  className="tabular-nums flex-1 min-h-[42px] rounded-xl border border-border text-sm font-bold text-muted"
                >
                  +{c}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl bg-accent/5 px-3.5 py-3">
              <span className="text-sm font-semibold text-accent">New total</span>
              <span className="tabular-nums text-lg font-extrabold text-accent">{newTotal}</span>
            </div>
          </>
        ) : (
          <div className="mt-4 flex items-center justify-between rounded-xl bg-ground px-3.5 py-3">
            <span className="text-sm font-semibold text-muted">Add stock</span>
            <span className="text-xs font-medium text-muted-2">Admin / Permission required</span>
          </div>
        )}

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">Price each</div>
        {canEditPrice ? (
          <>
            <div className="flex items-center gap-2.5">
              <input
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                inputMode="decimal"
                className="tabular-nums h-[50px] flex-1 rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-lg font-bold text-ink"
              />
              <button
                onClick={() => setPrice(product.lastPrice || product.price)}
                className="min-h-[50px] rounded-xl border border-border px-3.5 text-sm font-bold text-muted"
              >
                Last price
              </button>
            </div>
            {!!product.lastPrice && (
              <p className="tabular-nums mt-1 text-xs font-medium text-muted-2">
                Last price {money(product.lastPrice)}
              </p>
            )}
          </>
        ) : (
          <div className="tabular-nums flex h-[50px] items-center rounded-xl bg-ground px-3.5 text-lg font-bold text-muted">
            {money(price)}
            <span className="ml-auto text-xs font-medium text-muted-2">Admin only</span>
          </div>
        )}

        {canSeeCost && (
          <>
            <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">
              Cost price
              <span className="rounded-md bg-ground px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-muted">
                Admin only
              </span>
            </div>
            <input
              value={costPrice}
              onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value) || 0))}
              inputMode="decimal"
              className="tabular-nums h-[50px] w-full rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-lg font-bold text-ink"
            />
            {costPrice > 0 && (
              <p
                className={`tabular-nums mt-1 text-xs font-semibold ${
                  margin < 0 ? "text-danger" : "text-muted-2"
                }`}
              >
                Margin {money(margin)} each
                {price > 0 && ` — ${Math.round((margin / price) * 100)}%`}
                {margin < 0 && " — selling below cost"}
              </p>
            )}
          </>
        )}

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Expiry date
        </div>
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="h-[50px] w-full rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-base font-medium text-ink"
        />

        <div className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Min &amp; max
          <span className="rounded-md bg-ground px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-muted">
            Optional
          </span>
        </div>
        <div className="flex gap-2.5">
          <input
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
            placeholder="Min"
            inputMode="numeric"
            className="h-[50px] flex-1 rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-base font-medium text-ink"
          />
          <input
            value={maxLevel}
            onChange={(e) => setMaxLevel(e.target.value)}
            placeholder="Max"
            inputMode="numeric"
            className="h-[50px] flex-1 rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-base font-medium text-ink"
          />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-ground px-3.5 py-3">
          <span className="text-sm font-semibold text-muted">Added stock value</span>
          <span className="tabular-nums text-lg font-extrabold">{money(intakeValue)}</span>
        </div>
        {canSeeCost && intakeCost > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-ground px-3.5 py-3">
            <span className="text-sm font-semibold text-muted">Added stock cost</span>
            <span className="tabular-nums text-lg font-extrabold text-muted">{money(intakeCost)}</span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 min-h-[54px] w-full rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
