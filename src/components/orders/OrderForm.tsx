"use client";

import { useMemo, useRef, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { useCustomers } from "@/lib/firestore/customers";
import { useProducts } from "@/lib/firestore/products";
import { placeOrder, updateOrder, type OrderLineInput } from "@/lib/firestore/orders";
import { usePermissions } from "@/lib/firestore/permissions";
import { round2 } from "@/lib/billLines";
import LineSheet from "@/components/LineSheet";
import { useCustomerLabel } from "@/lib/customerName";
import { useOnline } from "@/lib/online";
import { localDateKey, money } from "@/lib/format";
import { dateKeyAdd, orderLabel, qtyText, relativeDay, shortDate } from "@/lib/orders";
import PadSheet from "@/components/orders/PadSheet";
import type { BillLine, Order } from "@/lib/types";

interface DraftLine {
  key: string;
  productId: string;
  qty: number;
  /** A price typed on the line sheet. Undefined keeps the booked / list price. */
  price?: number;
  /** "Rs 5000 of chicken": the amount typed; qty was worked out from it. Shown, not stored on the order. */
  amount?: number;
}

type Pad = { kind: "charge" };

let lineSeq = 0;
const newKey = () => `l${Date.now()}-${lineSeq++}`;

/**
 * New order, or an admin changing a confirmed one. Placing goes through the
 * placeOrder function, which numbers it and texts the customer, so it needs
 * the internet — said up front rather than discovered on a spinner.
 */
export default function OrderForm({
  order,
  isAdmin,
  onClose,
  onSaved,
}: {
  order?: Order;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = !!order;
  const today = localDateKey();
  const online = useOnline();
  const { customers, loading: customersLoading } = useCustomers();
  const { products } = useProducts();
  const { label } = useCustomerLabel();
  const { permissions } = usePermissions();
  // Same switch as the till: admins, and cashiers allowed to change bill prices.
  // Editing a confirmed order is admin only anyway.
  const canEditPrice = isAdmin || (!editing && permissions.editBillPrices);

  const [customerId, setCustomerId] = useState<string | null>(order?.customerId ?? null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [date, setDate] = useState(order?.deliveryDate ?? dateKeyAdd(today, 1));
  const [lines, setLines] = useState<DraftLine[]>(
    () => order?.lines.map((l) => ({ key: newKey(), productId: l.productId, qty: l.qty })) ?? [],
  );
  const [charge, setCharge] = useState(order?.deliveryCharge ?? 0);
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [productSearch, setProductSearch] = useState("");
  const [pad, setPad] = useState<Pad | null>(null);
  /** The line open in the line sheet. */
  const [sheet, setSheet] = useState<{ key: string } | null>(null);
  /** A product just tapped in: closing its sheet without Done drops it (as on the till). */
  const freshRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bookedPrice = useMemo(() => new Map(order?.lines.map((l) => [l.productId, l.price]) ?? []), [order]);

  const customerMatches = useMemo(() => {
    const n = customerSearch.trim().toLowerCase();
    const list = n ? customers.filter((c) => label(c.name).toLowerCase().includes(n)) : customers;
    // Shops first: they are the ones who order ahead.
    return [...list].sort((a, b) => (a.type === b.type ? 0 : a.type === "shop" ? -1 : 1)).slice(0, 40);
  }, [customers, customerSearch, label]);

  const productMatches = useMemo(() => {
    const n = productSearch.trim().toLowerCase();
    return n ? products.filter((p) => p.name.toLowerCase().includes(n)) : products;
  }, [products, productSearch]);

  /** The price a line is booked at: set by hand (admin), kept from the order, or today's list price. */
  const priceOf = (l: DraftLine) => l.price ?? bookedPrice.get(l.productId) ?? productById.get(l.productId)?.price ?? 0;
  const lineTotal = (l: DraftLine) => l.amount ?? round2(priceOf(l) * l.qty);
  const estimate = round2(lines.reduce((s, l) => s + lineTotal(l), 0) + charge);

  /** Like the till: tapping a product adds it and opens its line sheet. */
  function addProduct(productId: string) {
    const key = newKey();
    setLines((prev) => [...prev, { key, productId, qty: 1 }]);
    freshRef.current = key;
    setSheet({ key });
    setProductSearch("");
  }

  function closeSheet() {
    const fresh = freshRef.current;
    freshRef.current = null;
    if (fresh !== null && fresh === sheet?.key) setLines((prev) => prev.filter((x) => x.key !== fresh));
    setSheet(null);
  }

  const dateChips = [1, 2, 3, 7].map((n) => dateKeyAdd(today, n));
  const problems: string[] = [];
  if (!customer) problems.push("Pick a customer");
  if (lines.length === 0) problems.push("Add at least one product");
  // An overdue order keeps its own (past) day when an admin fixes something else on it.
  if (date < today && date !== order?.deliveryDate) problems.push("The delivery date is in the past");

  async function handleSave() {
    if (problems.length || !customer) return;
    setSaving(true);
    setError(null);
    const payload: OrderLineInput[] = lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      ...(canEditPrice && l.price !== undefined ? { price: l.price } : {}),
    }));
    try {
      if (order) {
        const r = await updateOrder({
          orderId: order.id,
          action: "edit",
          changes: { deliveryDate: date, lines: payload, deliveryCharge: charge, notes: notes.trim() || null },
        });
        onSaved(r.data.changed ? `${orderLabel(order.orderNo)} updated` : "Nothing changed");
      } else {
        const r = await placeOrder({
          customerId: customer.id,
          deliveryDate: date,
          lines: payload,
          deliveryCharge: charge,
          notes: notes.trim() || null,
        });
        const sms =
          r.data.sms === "sent"
            ? "confirmation SMS sent"
            : r.data.sms === "no-mobile"
              ? "no SMS (no mobile on record)"
              : r.data.sms === "failed"
                ? "SMS failed to send"
                : "SMS is switched off";
        onSaved(`${orderLabel(r.data.orderNo)} placed for ${shortDate(date)} · ${sms}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const sheetLine = sheet ? lines.find((l) => l.key === sheet.key) : undefined;
  const sheetProduct = sheetLine ? productById.get(sheetLine.productId) : undefined;
  const nameOf = (l: DraftLine) =>
    productById.get(l.productId)?.name ?? order?.lines.find((x) => x.productId === l.productId)?.name ?? "Removed product";
  const unitOf = (l: DraftLine) =>
    productById.get(l.productId)?.unit ?? order?.lines.find((x) => x.productId === l.productId)?.unit ?? "";
  /** The draft as the till's line sheet sees it. */
  const asBillLine = (l: DraftLine): BillLine => {
    const list = productById.get(l.productId)?.price;
    const price = priceOf(l);
    return {
      productId: l.productId,
      name: nameOf(l),
      qty: l.qty,
      price,
      ...(l.amount !== undefined ? { amount: l.amount } : {}),
      ...(list !== undefined && list !== price ? { listPrice: list } : {}),
    };
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-surface sm:max-h-[92dvh] sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-xl font-extrabold">{order ? `Change ${orderLabel(order.orderNo)}` : "New order"}</h2>
            <p className="text-sm font-medium text-muted">
              {order ? "Every change is logged" : "Weighed and billed on the delivery day"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {/* Customer */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Customer</h3>
            {customer ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-accent bg-accent/5 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-bold">{label(customer.name)}</div>
                  <div className="text-xs font-semibold text-muted">
                    {customer.type === "shop" ? "Shop" : "Person"}
                    {customer.remainingCredit > 0 && <> · owes {money(customer.remainingCredit)}</>}
                  </div>
                </div>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => setCustomerId(null)}
                    className="min-h-[44px] shrink-0 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted"
                  >
                    Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
                  <input
                    id="order-customer-search"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search shops and customers"
                    className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-3 text-base outline-none focus:border-accent"
                  />
                </div>
                <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {customersLoading && customers.length === 0 ? (
                    <div className="skeleton-in flex flex-col gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="skeleton block h-12 rounded-xl" />
                      ))}
                    </div>
                  ) : customerMatches.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted">
                      No customer matches. Add them on Customers first. An order needs a customer account.
                    </p>
                  ) : (
                    customerMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCustomerId(c.id)}
                        className="flex min-h-[48px] items-center justify-between gap-2 rounded-xl border border-border px-3.5 text-left active:bg-ground"
                      >
                        <span className="truncate font-semibold">{label(c.name)}</span>
                        <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-muted-2">
                          {c.type === "shop" ? "Shop" : "Person"}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </section>

          {/* Date */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Delivery day</h3>
            <div className="flex flex-wrap gap-2">
              {dateChips.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDate(d)}
                  className={`min-h-[44px] rounded-xl border px-3.5 text-sm font-bold ${
                    date === d ? "border-accent bg-accent text-white" : "border-border text-ink"
                  }`}
                >
                  {relativeDay(d, today)}
                  {relativeDay(d, today) !== shortDate(d) && (
                    <span className={`ml-1.5 font-semibold ${date === d ? "text-white/80" : "text-muted"}`}>{shortDate(d)}</span>
                  )}
                </button>
              ))}
              <label className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-3 text-sm font-bold">
                <span className="text-muted">Other</span>
                <input
                  id="order-date"
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="bg-transparent font-bold outline-none"
                />
              </label>
            </div>
          </section>

          {/* Lines */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Products</h3>
            {lines.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {lines.map((l) => {
                  const name = nameOf(l);
                  const unit = unitOf(l);
                  const custom = l.price !== undefined && l.price !== productById.get(l.productId)?.price;
                  return (
                    <li key={l.key} className="flex items-stretch gap-1 rounded-xl border border-border">
                      <button
                        type="button"
                        onClick={() => {
                          freshRef.current = null;
                          setSheet({ key: l.key });
                        }}
                        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left active:bg-ground"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{name}</span>
                          <span className={`tabular-nums block text-xs font-medium ${custom ? "text-warning" : "text-muted"}`}>
                            {qtyText(l.qty, unit)} × {money(priceOf(l))}
                            {custom && " · own price"}
                            {l.amount !== undefined && " · by amount"}
                          </span>
                        </span>
                        <span className="tabular-nums shrink-0 text-base font-extrabold">{money(lineTotal(l))}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${name}`}
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        className="flex w-11 shrink-0 items-center justify-center rounded-r-xl text-muted-2 active:bg-ground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
              <input
                id="order-product-search"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Add a product"
                className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-3 text-base outline-none focus:border-accent"
              />
            </div>
            <div className="grid max-h-60 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
              {productMatches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p.id)}
                  className="flex min-h-[56px] flex-col justify-center rounded-xl border border-border px-3 py-2 text-left active:bg-ground"
                >
                  <span className="line-clamp-2 text-sm font-bold leading-tight">{p.name}</span>
                  <span className="tabular-nums text-xs font-medium text-muted">
                    {money(p.price)}/{p.unit}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Extras */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Delivery charge (optional)</h3>
            <button
              type="button"
              onClick={() => setPad({ kind: "charge" })}
              className="tabular-nums flex min-h-[48px] items-center justify-between rounded-xl border border-border px-4 text-left"
            >
              <span className="font-semibold text-muted">Delivery charge</span>
              <span className="text-base font-extrabold">{charge > 0 ? money(charge) : "None"}</span>
            </button>
            <label htmlFor="order-notes" className="mt-1 text-[11px] font-bold uppercase tracking-wider text-muted-2">
              Notes
            </label>
            <textarea
              id="order-notes"
              value={notes}
              maxLength={300}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Cut into 8, deliver before 9am…"
              className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-accent"
            />
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {error && (
            <p role="alert" className="text-sm font-bold text-danger">
              {error}
            </p>
          )}
          {!online && <p className="text-sm font-bold text-warning">Placing or changing an order needs the internet.</p>}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Estimate</div>
              <div className="tabular-nums text-lg font-extrabold">{money(estimate)}</div>
            </div>
            <button
              type="button"
              disabled={saving || problems.length > 0 || !online}
              onClick={handleSave}
              title={problems[0]}
              className="min-h-[56px] flex-[2] rounded-2xl bg-accent px-5 text-base font-extrabold text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : order ? "Save changes" : `Place order · ${shortDate(date)}`}
            </button>
          </div>
          {problems.length > 0 && !saving && <p className="text-xs font-semibold text-muted">{problems[0]}</p>}
        </div>
      </div>

      {sheet && sheetLine && (
        <LineSheet
          key={sheetLine.key}
          layer="z-50"
          line={asBillLine(sheetLine)}
          unit={unitOf(sheetLine)}
          imageUrl={sheetProduct?.imageUrl ?? null}
          canEditPrice={canEditPrice}
          scope="this order only"
          removeLabel="Remove from order"
          priceLockedNote={
            editing ? "Only an admin can change prices on an order." : "Price changes are off for cashiers — an admin can allow them in Settings."
          }
          onRemove={() => {
            setLines((prev) => prev.filter((x) => x.key !== sheetLine.key));
            setSheet(null);
          }}
          onApply={(e) => {
            freshRef.current = null;
            setLines((prev) =>
              prev.map((x) =>
                x.key === sheetLine.key
                  ? {
                      ...x,
                      qty: e.qty,
                      // Kept only when it differs from what the line would be priced at anyway.
                      price: canEditPrice && e.price !== priceOf({ ...x, price: undefined }) ? e.price : undefined,
                      amount: e.amount,
                    }
                  : x,
              ),
            );
            setSheet(null);
          }}
          onClose={closeSheet}
        />
      )}
      {pad?.kind === "charge" && (
        <PadSheet
          title="Delivery charge"
          hint="Leave at 0 for none"
          initial={charge}
          decimals={0}
          prefix="Rs"
          allowZero
          onClose={() => setPad(null)}
          onDone={(v) => {
            setCharge(v);
            setPad(null);
          }}
        />
      )}
    </div>
  );
}
