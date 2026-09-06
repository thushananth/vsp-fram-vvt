"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import ProductThumb from "@/components/ui/ProductThumb";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Choosing one product out of three hundred.
 *
 * A `<select>` of every product — which is what the return form used to be — is
 * unusable at that size on a tablet. This is a full-height sheet: type two or
 * three letters, see photos and prices, tap one. `suggested` floats the handful
 * that are actually likely (today's bakery items, say) to the top before any
 * search is typed, so the common case needs no typing at all.
 */
export default function ProductPicker({
  products,
  suggestedIds = [],
  suggestedLabel = "Likely",
  title = "Choose an item",
  onPick,
  onClose,
}: {
  products: Product[];
  suggestedIds?: string[];
  suggestedLabel?: string;
  title?: string;
  onPick: (product: Product) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const { suggested, rest } = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matches = products.filter(
      (p) =>
        !needle ||
        p.name.toLowerCase().includes(needle) ||
        (p.barcode ?? "").toLowerCase().includes(needle),
    );
    const ids = new Set(suggestedIds);
    return {
      suggested: matches.filter((p) => ids.has(p.id)),
      rest: matches.filter((p) => !ids.has(p.id)),
    };
  }, [products, suggestedIds, search]);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/50">
      <div className="mx-auto flex h-[88vh] w-full max-w-lg flex-col rounded-t-3xl bg-surface">
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button
            onClick={onClose}
            className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <div className="relative px-5 pb-3">
          <Search className="pointer-events-none absolute left-8 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a name or barcode"
            aria-label="Search products"
            className="w-full rounded-xl border border-border bg-ground py-3.5 pl-11 pr-11 text-base outline-none focus:border-accent"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-8 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-2"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {suggested.length > 0 && (
            <>
              <SectionLabel>{suggestedLabel}</SectionLabel>
              <Rows products={suggested} onPick={onPick} />
            </>
          )}
          {rest.length > 0 && (
            <>
              {suggested.length > 0 && <SectionLabel>Everything else</SectionLabel>}
              <Rows products={rest} onPick={onPick} />
            </>
          )}
          {suggested.length === 0 && rest.length === 0 && (
            <p className="py-10 text-center text-muted">
              {search ? `Nothing matches “${search.trim()}”.` : "No products yet."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wider text-muted-2 first:mt-0">
      {children}
    </div>
  );
}

function Rows({ products, onPick }: { products: Product[]; onPick: (p: Product) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {products.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p)}
          className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left"
        >
          <ProductThumb name={p.name} imageUrl={p.imageUrl} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold">{p.name}</span>
            <span className="block truncate text-[11px] font-medium text-muted-2">
              {p.category}
              {p.barcode ? ` · ${p.barcode}` : ""}
            </span>
          </span>
          <span className="tabular-nums shrink-0 text-sm font-bold text-accent">
            {money(p.price)}
          </span>
        </button>
      ))}
    </div>
  );
}
