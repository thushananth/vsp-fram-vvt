"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Search, Tags, X } from "lucide-react";
import Splash from "@/components/Splash";
import NumField from "@/components/ui/NumField";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/lib/firestore/permissions";
import {
  createProduct,
  setProductActive,
  updateProduct,
  useProducts,
  type ProductInput,
} from "@/lib/firestore/products";
import {
  createCategory,
  reorderCategories,
  setCategoryActive,
  updateCategory,
  useCategories,
  type CategoryInput,
} from "@/lib/firestore/categories";
import { CATEGORY_COLORS, PRODUCT_UNITS } from "@/lib/constants";
import { money } from "@/lib/format";
import type { Category, Product } from "@/lib/types";

type Tab = "products" | "categories";

export default function ProductsPage() {
  const { can, loading: canLoading } = useCan();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const { products, loading } = useProducts({ includeInactive: true });
  const { categories, loading: catLoading } = useCategories();
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string | "hidden" | null>(null);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [editingCat, setEditingCat] = useState<Category | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCats = categories.filter((c) => c.active);
  const countIn = (categoryId: string) => products.filter((p) => p.categoryId === categoryId && p.active).length;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "hidden" ? p.active : !p.active) return false;
      if (filter && filter !== "hidden" && p.categoryId !== filter) return false;
      return !needle || p.name.toLowerCase().includes(needle) || (p.barcode ?? "").includes(needle);
    });
  }, [products, search, filter]);

  // Grouped under their category, in the category order the till uses.
  const groups = useMemo(() => {
    const order = new Map(categories.map((c, i) => [c.id, i]));
    const byCat = new Map<string, Product[]>();
    for (const p of shown) byCat.set(p.categoryId, [...(byCat.get(p.categoryId) ?? []), p]);
    return [...byCat.entries()]
      .map(([id, list]) => ({ category: categories.find((c) => c.id === id) ?? null, id, list }))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [shown, categories]);

  async function run(task: () => Promise<unknown>) {
    setError(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function move(index: number, delta: number) {
    const list = [...activeCats];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    await run(() => reorderCategories(list));
  }

  if (canLoading) return <Splash />;

  return (
    <div className="mx-auto max-w-4xl p-4 pb-28">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Products</h1>
          <p className="text-sm font-medium text-muted">
            {products.filter((p) => p.active).length} on the till · {activeCats.length} categories
          </p>
        </div>
        {tab === "products" && can("addProducts") && (
          <button
            onClick={() => setEditing("new")}
            disabled={activeCats.length === 0}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            <Plus size={17} /> Product
          </button>
        )}
        {tab === "categories" && can("manageCategories") && (
          <button
            onClick={() => setEditingCat("new")}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-white"
          >
            <Plus size={17} /> Category
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {(["products", "categories"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-[40px] flex-1 rounded-lg text-[13px] font-bold capitalize ${
              tab === t ? "bg-white shadow-sm" : "text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">
          {error}
        </p>
      )}

      {tab === "products" ? (
        <>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products"
              className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
            <Chip on={filter === null} onClick={() => setFilter(null)}>
              All
            </Chip>
            {activeCats.map((c) => (
              <Chip key={c.id} on={filter === c.id} color={c.color} onClick={() => setFilter(filter === c.id ? null : c.id)}>
                {c.name}
              </Chip>
            ))}
            <Chip on={filter === "hidden"} onClick={() => setFilter(filter === "hidden" ? null : "hidden")}>
              Hidden
            </Chip>
          </div>

          {loading || catLoading ? (
            <p className="py-10 text-center text-muted">Loading…</p>
          ) : activeCats.length === 0 ? (
            <Empty
              title="Start with a category"
              body="Every product belongs to a category — Chicken, Egg, Grocery… Add one first."
              action={can("manageCategories") ? () => { setTab("categories"); setEditingCat("new"); } : undefined}
              actionLabel="Add a category"
            />
          ) : groups.length === 0 ? (
            <Empty
              title={search ? "Nothing matches" : filter === "hidden" ? "No hidden products" : "No products yet"}
              body={search ? "Try another name." : "Products you add show up on the till straight away."}
              action={!search && filter !== "hidden" && can("addProducts") ? () => setEditing("new") : undefined}
              actionLabel="Add a product"
            />
          ) : (
            <div className="mt-4 flex flex-col gap-5">
              {groups.map((g) => (
                <section key={g.id}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.category?.color ?? "#94a3b8" }} />
                    <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-muted">
                      {g.category?.name ?? "No category"}
                    </h2>
                    <span className="text-xs font-semibold text-muted-2">{g.list.length}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.list.map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 ${
                          p.active ? "" : "opacity-60"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-bold">{p.name}</div>
                          <div className="tabular-nums text-xs font-semibold text-muted">
                            {money(p.price)} / {p.unit}
                            {isAdmin && p.costPrice > 0 && (
                              <span className="text-muted-2"> · cost {money(p.costPrice)}</span>
                            )}
                          </div>
                        </div>
                        {can("toggleProducts") && (
                          <IconButton
                            label={p.active ? "Hide from till" : "Show on till"}
                            onClick={() => run(() => setProductActive(p.id, !p.active))}
                          >
                            {p.active ? <Eye size={17} /> : <EyeOff size={17} />}
                          </IconButton>
                        )}
                        {can("editProducts") && (
                          <IconButton label="Edit" onClick={() => setEditing(p)}>
                            <Pencil size={16} />
                          </IconButton>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {catLoading ? (
            <p className="py-10 text-center text-muted">Loading…</p>
          ) : categories.length === 0 ? (
            <Empty
              title="No categories yet"
              body="Group what you sell — Chicken, Egg, Grocery — so the till can filter by it."
              action={can("manageCategories") ? () => setEditingCat("new") : undefined}
              actionLabel="Add a category"
            />
          ) : (
            <>
              {activeCats.map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: c.color }}
                  >
                    <Tags size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{c.name}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted">
                      <span>{countIn(c.id)} products</span>
                      <span>· sold in {c.unit}</span>
                      {c.counterCopy && (
                        <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                          COUNTER COPY
                        </span>
                      )}
                    </div>
                  </div>
                  {can("manageCategories") && (
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton label="Move down" onClick={() => move(i, 1)} disabled={i === activeCats.length - 1}>
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton label="Edit" onClick={() => setEditingCat(c)}>
                        <Pencil size={16} />
                      </IconButton>
                    </div>
                  )}
                </div>
              ))}
              {categories.some((c) => !c.active) && (
                <>
                  <h2 className="mt-4 px-1 text-[11px] font-bold uppercase tracking-wider text-muted-2">Archived</h2>
                  {categories
                    .filter((c) => !c.active)
                    .map((c) => (
                      <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-3.5 py-3">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="flex-1 text-sm font-bold text-muted">{c.name}</span>
                        {can("manageCategories") && (
                          <button
                            onClick={() => run(() => setCategoryActive(c.id, true))}
                            className="min-h-[36px] rounded-lg border border-border px-3 text-xs font-bold"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    ))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {editing && (
        <ProductSheet
          product={editing === "new" ? null : editing}
          categories={activeCats}
          defaultCategoryId={filter && filter !== "hidden" ? filter : activeCats[0]?.id}
          showCost={isAdmin}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await createProduct(input);
            else await updateProduct(editing.id, input);
            setEditing(null);
          }}
        />
      )}

      {editingCat && (
        <CategorySheet
          category={editingCat === "new" ? null : editingCat}
          productCount={editingCat === "new" ? 0 : countIn(editingCat.id)}
          onClose={() => setEditingCat(null)}
          onSave={async (input) => {
            if (editingCat === "new") await createCategory(input, categories.length);
            else
              await updateCategory(
                editingCat,
                input,
                products.filter((p) => p.categoryId === editingCat.id).map((p) => p.id),
              );
            setEditingCat(null);
          }}
          onArchive={
            editingCat === "new"
              ? undefined
              : async () => {
                  await setCategoryActive(editingCat.id, false);
                  setEditingCat(null);
                }
          }
        />
      )}
    </div>
  );
}

function Chip({
  on,
  color,
  onClick,
  children,
}: {
  on: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={on && color ? { backgroundColor: color, borderColor: color } : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${
        on ? (color ? "text-white" : "border-ink bg-ink text-white") : "border-border bg-surface text-ink"
      }`}
    >
      {color && !on && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-ground hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Empty({
  title,
  body,
  action,
  actionLabel,
}: {
  title: string;
  body: string;
  action?: () => void;
  actionLabel: string;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-base font-extrabold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-muted">{body}</p>
      {action && (
        <button onClick={action} className="mt-4 min-h-[44px] rounded-xl bg-accent px-5 text-sm font-bold text-white">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/50 sm:items-center sm:justify-center sm:p-4">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">{children}</div>;
}

const inputClass =
  "h-12 w-full rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-base font-semibold outline-none focus:border-accent";

function ProductSheet({
  product,
  categories,
  defaultCategoryId,
  showCost,
  onClose,
  onSave,
}: {
  product: Product | null;
  categories: Category[];
  defaultCategoryId?: string;
  showCost: boolean;
  onClose: () => void;
  onSave: (input: ProductInput) => Promise<void>;
}) {
  const initialCat = categories.find((c) => c.id === (product?.categoryId ?? defaultCategoryId)) ?? categories[0];
  const [name, setName] = useState(product?.name ?? "");
  const [categoryId, setCategoryId] = useState(initialCat?.id ?? "");
  const [unit, setUnit] = useState(product?.unit ?? initialCat?.unit ?? "pcs");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [cost, setCost] = useState(product?.costPrice ? String(product.costPrice) : "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const cat = categories.find((c) => c.id === categoryId);
      await onSave({
        name,
        categoryId,
        category: cat?.name ?? "",
        unit,
        price: Number(price) || 0,
        costPrice: showCost ? Number(cost) || 0 : (product?.costPrice ?? 0),
        barcode: barcode || null,
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Sheet title={product ? "Edit product" : "New product"} onClose={onClose}>
      <Label>Name</Label>
      <input autoFocus={!product} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Broiler" className={inputClass} />

      <Label>Category</Label>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <Chip
            key={c.id}
            on={categoryId === c.id}
            color={c.color}
            onClick={() => {
              setCategoryId(c.id);
              // A new product follows its category's unit until told otherwise.
              if (!product) setUnit(c.unit);
            }}
          >
            {c.name}
          </Chip>
        ))}
      </div>

      <Label>Sold per</Label>
      <div className="flex h-12 gap-1 rounded-xl bg-ground p-1">
        {PRODUCT_UNITS.map((u) => (
          <button
            key={u}
            onClick={() => setUnit(u)}
            className={`flex-1 rounded-lg text-[13px] font-bold ${unit === u ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {u}
          </button>
        ))}
      </div>

      <Label>Price per {unit}</Label>
      <NumField
        value={price}
        onValue={setPrice}
        placeholder="0"
        aria-label="Price"
        className={`${inputClass} tabular-nums text-right`}
      />

      {showCost && (
        <>
          <Label>Cost price (admin only)</Label>
          <NumField value={cost} onValue={setCost} placeholder="What the shop pays — for profit" aria-label="Cost price" className={`${inputClass} tabular-nums text-right`} />
        </>
      )}

      <Label>Barcode (optional)</Label>
      <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" className={inputClass} />

      {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="mt-5 min-h-[52px] w-full rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : product ? "Save changes" : "Add product"}
      </button>
    </Sheet>
  );
}

function CategorySheet({
  category,
  productCount,
  onClose,
  onSave,
  onArchive,
}: {
  category: Category | null;
  productCount: number;
  onClose: () => void;
  onSave: (input: CategoryInput) => Promise<void>;
  onArchive?: () => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]);
  const [unit, setUnit] = useState(category?.unit ?? "pcs");
  const [counterCopy, setCounterCopy] = useState(category?.counterCopy ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(task: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Sheet title={category ? "Edit category" : "New category"} onClose={onClose}>
      <Label>Name</Label>
      <input autoFocus={!category} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken" className={inputClass} />

      <Label>Colour</Label>
      <div className="flex flex-wrap gap-2.5">
        {CATEGORY_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            className={`h-9 w-9 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-ink" : ""}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <Label>Usually sold per</Label>
      <div className="flex h-12 gap-1 rounded-xl bg-ground p-1">
        {PRODUCT_UNITS.map((u) => (
          <button
            key={u}
            onClick={() => setUnit(u)}
            className={`flex-1 rounded-lg text-[13px] font-bold ${unit === u ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {u}
          </button>
        ))}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={counterCopy}
        onClick={() => setCounterCopy(!counterCopy)}
        className="mt-4 flex w-full items-center gap-3 rounded-xl border border-border px-3.5 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Print a counter copy</span>
          <span className="block text-xs font-medium text-muted">
            Bills with anything from this category print a second ticket for the counter.
          </span>
        </span>
        <span className={`relative h-6 w-11 shrink-0 rounded-full ${counterCopy ? "bg-accent" : "bg-border"}`}>
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              counterCopy ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>

      {error && <p className="mt-3 text-sm font-bold text-danger">{error}</p>}

      <button
        onClick={() =>
          act(async () => {
            if (!name.trim()) throw new Error("Enter the category name.");
            await onSave({ name, color, unit, counterCopy });
          })
        }
        disabled={saving}
        className="mt-5 min-h-[52px] w-full rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : category ? "Save changes" : "Add category"}
      </button>
      {onArchive && (
        <button
          onClick={() =>
            act(async () => {
              if (productCount > 0) throw new Error(`Move or hide its ${productCount} products first.`);
              await onArchive();
            })
          }
          disabled={saving}
          className="mt-2 min-h-[48px] w-full rounded-2xl text-sm font-bold text-danger"
        >
          Archive category
        </button>
      )}
    </Sheet>
  );
}
