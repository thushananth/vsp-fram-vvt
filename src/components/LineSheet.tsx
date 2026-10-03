"use client";

import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import ProductThumb from "@/components/ui/ProductThumb";
import NumPad, { applyKey, type PadKey } from "@/components/ui/NumPad";
import { round2, round3 } from "@/lib/billLines";
import { money } from "@/lib/format";
import type { BillLine } from "@/lib/types";

type Field = "qty" | "price" | "amount";

export interface LineEdit {
  qty: number;
  price: number;
  /** Set when the cashier typed the line total; it is then charged exactly. */
  amount?: number;
}

const DECIMALS: Record<Field, number> = { qty: 3, price: 2, amount: 2 };

/**
 * Tapping a product (or a line in the basket) opens this. Quantity, price each
 * and the line total are tapped to select, then typed on the pad beside them.
 * Typing a total ("Rs 1500 of chicken") works the quantity out from the price,
 * and the bill then charges exactly that total.
 */
export default function LineSheet({
  line,
  unit,
  imageUrl,
  canEditPrice,
  onApply,
  onRemove,
  onClose,
}: {
  line: BillLine;
  unit: string;
  imageUrl: string | null;
  canEditPrice: boolean;
  onApply: (edit: LineEdit) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // Touching a box empties it straight away — the old value stays visible,
  // faded, as `held` — so the cashier types the new number without deleting
  // first. Quantity is selected (and so empty) when the sheet opens.
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState(String(line.price));
  // Empty means "qty × price"; filled means the cashier asked for an amount.
  const [amount, setAmount] = useState(line.amount !== undefined ? String(line.amount) : "");
  const [field, setField] = useState<Field>("qty");
  const [held, setHeld] = useState(String(line.qty));
  // The emptied Line total box held an amount the cashier had typed (not just
  // qty × price), so leaving it untouched keeps charging that amount.
  const [heldTyped, setHeldTyped] = useState(false);

  // An emptied box still means its old value until something is typed; a line
  // is removed only by Remove or a typed 0.
  const qtyText = qty === "" && field === "qty" ? held : qty;
  const priceText = price === "" && field === "price" ? held : price;
  const qtyValue = Math.max(0, Number(qtyText) || 0);
  const priceValue = priceText === "" ? line.price : Math.max(0, Number(priceText) || 0);
  const amountText = amount === "" && field === "amount" && heldTyped ? held : amount;
  const amountValue = amountText === "" ? null : Math.max(0, Number(amountText) || 0);
  const lineTotal = amountValue ?? round2(qtyValue * priceValue);

  function qtyFor(a: number, priceEach: number): string {
    if (a <= 0 || priceEach <= 0) return "0";
    return String(round3(a / priceEach));
  }

  function select(next: Field) {
    if (next === "price" && !canEditPrice) return;
    if (next === "amount" && priceValue <= 0) return;
    // The box being left gets its old value back if nothing was typed.
    if (field === "qty" && qty === "") setQty(held);
    if (field === "price" && price === "") setPrice(held);
    if (field === "amount" && amount === "" && heldTyped) setAmount(held);
    setHeld(next === "qty" ? qtyText : next === "price" ? priceText : amountValue !== null ? amountText : lineTotal.toFixed(2));
    setHeldTyped(next === "amount" && amountValue !== null);
    if (next === "qty") setQty("");
    if (next === "price") setPrice("");
    if (next === "amount") setAmount("");
    setField(next);
  }

  function type(key: PadKey) {
    const opts = { fresh: false, decimals: DECIMALS[field] };
    if (field === "qty") {
      setQty(applyKey(qty, key, opts));
      setAmount("");
    } else if (field === "price") {
      const next = applyKey(price, key, opts);
      setPrice(next);
      // Keep the amount the customer asked for; the quantity follows the price.
      if (amountValue !== null) setQty(qtyFor(amountValue, Math.max(0, Number(next) || 0)));
    } else {
      const next = applyKey(amount, key, opts);
      setAmount(next);
      setQty(qtyFor(Math.max(0, Number(next) || 0), priceValue));
    }
  }

  function step(delta: number) {
    if (field === "price" && price === "") setPrice(held);
    setQty(String(Math.max(0, round3(qtyValue + delta))));
    setHeldTyped(false);
    setAmount("");
    setField("qty");
  }

  function apply() {
    if (qtyValue <= 0) {
      onRemove();
      return;
    }
    onApply({
      qty: round3(qtyValue),
      price: priceValue,
      ...(amountValue !== null && amountValue > 0 ? { amount: round2(amountValue) } : {}),
    });
    onClose();
  }

  // A physical keyboard (or a USB number pad at the counter) still works.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) type(e.key as PadKey);
      else if (e.key === "." || e.key === ",") type(".");
      else if (e.key === "Backspace") type("back");
      else if (e.key === "Delete") type("clear");
      else if (e.key === "Enter") apply();
      else if (e.key === "Escape") onClose();
      else if (e.key === "Tab") {
        const order: Field[] = canEditPrice ? ["qty", "price", "amount"] : ["qty", "amount"];
        const next = order[(order.indexOf(field) + (e.shiftKey ? order.length - 1 : 1)) % order.length];
        select(next);
      } else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const box = (on: boolean, disabled = false) =>
    `tabular-nums flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left transition-colors ${
      disabled
        ? "cursor-not-allowed border-transparent bg-ground text-muted"
        : on
          ? "border-accent bg-accent/5"
          : "border-border bg-surface"
    }`;

  // The selected box, emptied: its old value shown faded until a key is typed.
  const shown = (f: Field, text: string, fallback: string) =>
    field === f && text === "" ? <span className="text-muted-2/70">{fallback}</span> : text;

  const caret = (on: boolean) =>
    on ? <span className="ml-0.5 inline-block h-6 w-0.5 animate-pulse bg-accent align-middle" /> : null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/50 md:items-center md:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Edit ${line.name}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-surface md:max-w-3xl md:rounded-3xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <ProductThumb name={line.name} imageUrl={imageUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-extrabold leading-tight">{line.name}</div>
            <div className="tabular-nums text-xs font-semibold text-muted">
              {money(line.listPrice ?? line.price)} / {unit || "each"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ground text-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[1fr_300px] md:gap-6">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-stretch gap-2">
              <button
                onClick={() => step(-1)}
                aria-label="One less"
                className="flex w-14 shrink-0 items-center justify-center rounded-2xl border border-border"
              >
                <Minus className="h-5 w-5" />
              </button>
              <button onClick={() => select("qty")} className={`${box(field === "qty")} h-[68px]`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Quantity</span>
                <span className="text-2xl font-extrabold">
                  {shown("qty", qty, held)}
                  {caret(field === "qty")}
                  <span className="ml-1.5 text-sm font-bold text-muted-2">{unit}</span>
                </span>
              </button>
              <button
                onClick={() => step(1)}
                aria-label="One more"
                className="flex w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-white"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            <button
              onClick={() => select("price")}
              disabled={!canEditPrice}
              className={`${box(field === "price", !canEditPrice)} h-[60px]`}
            >
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Price each</span>
              <span className="text-xl font-extrabold">
                {canEditPrice ? shown("price", price, held) : money(line.price)}
                {caret(field === "price")}
              </span>
            </button>
            {!canEditPrice && (
              <p className="-mt-1 px-1 text-[11px] font-medium text-muted-2">
                Price changes on the bill are off for cashiers — an admin can allow them in Settings.
              </p>
            )}
            {canEditPrice && line.listPrice !== undefined && priceValue !== line.listPrice && (
              <p className="-mt-1 px-1 text-[11px] font-bold text-warning">
                Normal price {money(line.listPrice)} — this bill only.
              </p>
            )}

            <button
              onClick={() => select("amount")}
              disabled={priceValue <= 0}
              className={`${box(field === "amount", priceValue <= 0)} h-[72px] ${
                field === "amount" ? "" : "bg-accent/5"
              }`}
            >
              <span>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-accent">Line total</span>
                <span className="block text-[11px] font-medium text-muted-2">
                  {amountValue !== null ? "Charged exactly" : "Tap to sell by amount"}
                </span>
              </span>
              <span className="text-2xl font-extrabold text-accent">
                {field === "amount" && amount === ""
                  ? shown("amount", amount, held)
                  : amountValue !== null
                    ? amountText
                    : lineTotal.toFixed(2)}
                {caret(field === "amount")}
              </span>
            </button>
            {amountValue !== null && amountValue > 0 && (
              <p className="tabular-nums px-1 text-xs font-semibold text-muted">
                {money(amountValue)} ÷ {money(priceValue)} = {qtyValue} {unit}
              </p>
            )}

            <div className="mt-auto hidden gap-2 pt-2 md:flex">
              <button
                onClick={onRemove}
                className="flex min-h-[56px] items-center justify-center gap-2 rounded-2xl border border-danger/40 px-5 font-bold text-danger"
              >
                <Trash2 className="h-[18px] w-[18px]" /> Remove
              </button>
              <button onClick={apply} className="min-h-[56px] flex-1 rounded-2xl bg-accent text-lg font-bold text-white">
                Done · {money(lineTotal)}
              </button>
            </div>
          </div>

          <NumPad onKey={type} allowDecimal={DECIMALS[field] > 0} />

          <div className="flex gap-2 md:hidden">
            <button
              onClick={onRemove}
              aria-label="Remove from bill"
              className="flex min-h-[56px] w-16 items-center justify-center rounded-2xl border border-danger/40 text-danger"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button onClick={apply} className="min-h-[56px] flex-1 rounded-2xl bg-accent text-lg font-bold text-white">
              Done · {money(lineTotal)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
