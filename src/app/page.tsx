"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProducts } from "@/lib/firestore/products";
import { usePermissions } from "@/lib/firestore/permissions";
import { createBill, type CreatedBill } from "@/lib/firestore/bills";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useStoreSettings } from "@/lib/firestore/settings";
import { LayoutGrid, List, Search, ShoppingBasket, X } from "lucide-react";
import CustomerSheet from "@/components/CustomerSheet";
import ProductThumb from "@/components/ui/ProductThumb";
import { printReceipt } from "@/lib/printer";
import { money } from "@/lib/format";
import type { BillLine, Customer, PaymentType, Product } from "@/lib/types";

const CATEGORIES = ["All", "Bakery", "Drinks", "Grocery"];

/** How long a bill may stay unacknowledged before the till calls it queued. */
const SYNC_GRACE_MS = 2500;

/** Money, not floating point — 0.1 + 0.2 has no place on a receipt. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function BillingPage() {
  const { products, loading } = useProducts();
  const { profile, user } = useAuth();
  const { settings } = useStoreSettings();
  const { permissions } = usePermissions();
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<BillLine[]>([]);
  const [tender, setTender] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  /** Why a charge was refused. Shown inside the basket, not as the bottom
   *  toast — the basket sheet covers that, so the cashier would never see it. */
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [dense, setDense] = useState(false);
  /** A short payment waiting on the cashier to confirm it goes on credit. */
  const [confirmingShort, setConfirmingShort] = useState<number | null>(null);

  // Its own permission, not the Stock one: a shop may well want a cashier to
  // discount a bun for a regular without letting them reprice the product.
  const canEditPrices = profile?.role === "admin" || permissions.editBillPrices;

  // A shop with 300 products can't be browsed as a grid — typing two or three
  // letters has to be the normal way in, with the category chips as a coarse
  // filter on top.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "All" && p.category.toLowerCase() !== category.toLowerCase()) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) || (p.barcode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [products, category, search]);

  const total = round2(cart.reduce((sum, l) => sum + l.price * l.qty, 0));
  const change = tender !== null ? Math.max(0, round2(tender - total)) : 0;
  /** What would still be owed if the bill were charged at this tender. */
  const shortfall = tender !== null ? Math.max(0, round2(total - tender)) : total;
  const line = cart.find((l) => l.productId === editingLine) ?? null;
  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);

  /**
   * Add one of a product to the bill. A product already on the bill keeps the
   * price it was given — re-tapping a discounted line must not quietly put it
   * back to list.
   */
  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, qty: 1, price: p.price, costPrice: p.costPrice },
      ];
    });
  }

  /**
   * Tapping a tile in the grid adds the product *and* opens its sheet, so the
   * price and quantity can be set in the same movement — a regular getting a
   * bun at 100 instead of 120 shouldn't take two separate taps to arrange.
   * A barcode scan deliberately skips the sheet: that is the fast lane, and a
   * modal on every beep would make scanning unusable.
   */
  function pickProduct(p: Product) {
    addToCart(p);
    setEditingLine(p.id);
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.productId !== productId)
        : prev.map((l) => (l.productId === productId ? { ...l, qty } : l)),
    );
  }

  /**
   * Change what this bill charges for a line. The product's own price is left
   * alone — an override is a one-off at the counter, not a price change — but
   * the list price is stamped on the line so the discount is visible later.
   */
  function setLinePrice(productId: string, price: number) {
    const listPrice = products.find((p) => p.id === productId)?.price;
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        // Back at list price, the override marker comes off again — but the
        // cost stays, because profit still has to be measurable.
        if (listPrice === undefined || price === listPrice) {
          return {
            productId: l.productId,
            name: l.name,
            qty: l.qty,
            price,
            costPrice: l.costPrice,
          };
        }
        return { ...l, price, listPrice };
      }),
    );
  }

  function removeLine(productId: string) {
    setCart((prev) => {
      const next = prev.filter((l) => l.productId !== productId);
      if (next.length === 0) setBasketOpen(false);
      return next;
    });
    setEditingLine(null);
  }

  /**
   * Enter, which is what a barcode scanner sends. An exact barcode match is
   * added straight to the bill with no sheet — scanning is the fast lane. A
   * typed search that has narrowed to one product opens its sheet instead,
   * because a person typing is choosing, not scanning.
   */
  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const typed = search.trim();
    if (!typed) return;

    const scanned = products.find((p) => p.barcode === typed);
    if (scanned) {
      addToCart(scanned);
      setSearch("");
      return;
    }
    if (filtered.length === 1) {
      pickProduct(filtered[0]);
      setSearch("");
    }
  }

  /**
   * The Charge button. Three outcomes, decided by what is on the counter:
   * enough money is a plain cash sale; short with a customer needs a nod that
   * the rest goes on their account; short from a walk-in is refused, because
   * there would be nobody to chase for the difference.
   */
  function handleCharge() {
    if (cart.length === 0 || tender === null) return;
    setChargeError(null);
    if (tender >= total) {
      void completeSale({ paid: total, tender, change, paymentType: "cash" });
      return;
    }
    if (!customer) {
      setChargeError(
        `Short by ${money(shortfall)}. A walk-in has to pay in full — take the rest, or pick a customer to put ${money(shortfall)} on credit.`,
      );
      return;
    }
    setConfirmingShort(tender);
  }

  /**
   * The bill on the customer's account. Whatever is typed in Paid still counts:
   * ignoring it here would drop cash that is already on the counter, which is
   * the one mistake this screen must never make.
   */
  function handleCredit() {
    if (cart.length === 0 || !customer) return;
    setChargeError(null);
    if (tender !== null && tender > 0) {
      if (tender >= total) {
        void completeSale({ paid: total, tender, change, paymentType: "cash" });
      } else {
        setConfirmingShort(tender);
      }
      return;
    }
    void completeSale({ paid: 0, tender: 0, change: 0, paymentType: "credit" });
  }

  function completeSale(payment: {
    paid: number;
    tender: number;
    change: number;
    paymentType: PaymentType;
  }) {
    const cashierId = profile?.uid ?? user?.uid;
    if (cart.length === 0 || !cashierId) return;
    setCharging(true);
    setConfirmingShort(null);
    // Snapshot the cart and customer for the receipt — state is cleared on success.
    const soldLines = cart;
    const soldTo = customer;
    const due = round2(total - payment.paid);
    // Decided here, from the live product list, because bills.ts has no way to
    // tell a bakery line from a barcoded good.
    const bakeryProductIds = soldLines
      .filter((l) => products.find((p) => p.id === l.productId)?.isBakery)
      .map((l) => l.productId);
    try {
      const result = createBill({
        lines: soldLines,
        total,
        paid: payment.paid,
        tender: payment.tender,
        change: payment.change,
        cashierId,
        paymentType: payment.paymentType,
        customerId: soldTo?.id ?? null,
        customerName: soldTo?.name ?? null,
        bakeryProductIds,
      });

      // The bill is durable the moment createBill returns — it is in the local
      // queue, which survives a reload. Whether the *server* has it yet is a
      // separate, slower question, so the till says "saved" now and upgrades
      // the message when the acknowledgement (or the timeout) arrives.
      setConfirmation(
        due > 0
          ? `Bill #${result.no} saved — ${soldTo!.name} owes ${money(due)}`
          : `Bill #${result.no} saved`,
      );
      trackSync(result);
      setCart([]);
      setTender(null);
      setCustomer(null);
      setEditingLine(null);
      setBasketOpen(false);
      setChargeError(null);

      if (!settings.printBills) return;

      const receiptLines = [
        "Bakery POS",
        `Bill #${result.no}`,
        ...(soldTo ? [`Customer: ${soldTo.name}`] : []),
        "--------------------------------",
        ...soldLines.map(
          (l) =>
            `${l.name}  ${l.qty} x ${l.price.toFixed(2)}  Rs ${(l.price * l.qty).toFixed(2)}`,
        ),
        "--------------------------------",
        `Total: Rs ${total.toFixed(2)}`,
        `Paid: Rs ${payment.paid.toFixed(2)}`,
        ...(due > 0
          ? [
              "BALANCE ON CREDIT",
              `Due: Rs ${due.toFixed(2)}`,
              `Balance: Rs ${((soldTo?.remainingCredit ?? 0) + due).toFixed(2)}`,
            ]
          : [`Tender: Rs ${payment.tender.toFixed(2)}`, `Change: Rs ${payment.change.toFixed(2)}`]),
      ];
      // Fire-and-forget: the WebUSB picker can block for as long as the
      // cashier takes to answer it, and Charge must stay usable meanwhile.
      printReceipt({ lines: receiptLines, cuts: true })
        .then((printed) => {
          if (!printed.success) {
            setConfirmation(`Bill #${result.no} saved — printing failed (${printed.error})`);
          }
        })
        .catch(() => {});
    } catch (err) {
      // Nothing was queued — a bad argument, or storage refusing the write.
      // Keep the cart so the cashier can retry.
      setConfirmation(`Bill not saved — try again (${(err as Error).message})`);
    } finally {
      setCharging(false);
    }
  }

  /** Follow one bill's acknowledgement without ever blocking the till on it. */
  function trackSync(result: CreatedBill) {
    let settled = false;
    const queuedNotice = window.setTimeout(() => {
      if (settled) return;
      // Built from this bill's own number, not from whatever the banner
      // happens to say — two quick sales would otherwise stack their notices.
      setConfirmation(
        `Bill #${result.no} saved · queued — syncs when the connection is back`,
      );
    }, SYNC_GRACE_MS);

    result.accepted.then(
      () => {
        settled = true;
        window.clearTimeout(queuedNotice);
      },
      (err: Error) => {
        settled = true;
        window.clearTimeout(queuedNotice);
        // Rejected by the server, not merely unsent. The bill is held in the
        // journal on the Bills screen, where it can be exported or re-sent.
        setConfirmation(
          `Bill #${result.no} was REFUSED by the server (${err.message}) — open Bills → Held to re-send it`,
        );
      },
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-3 pb-28">
      <form onSubmit={handleSearchSubmit} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Scan a barcode, or type a name"
          aria-label="Search products"
          className="w-full rounded-2xl border border-border bg-surface py-4 pl-11 pr-11 text-base outline-none focus:border-accent"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-2"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-2 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              category === c ? "bg-accent text-white" : "bg-surface text-muted border border-border"
            }`}
          >
            {c}
          </button>
        ))}
        </div>
        {/* Photos help pick a bun by sight; a list fits far more of a
            three-hundred-item catalogue on a small screen. Both are useful, so
            the cashier chooses. */}
        <button
          onClick={() => setDense((d) => !d)}
          aria-label={dense ? "Show photos" : "Show a compact list"}
          title={dense ? "Show photos" : "Show a compact list"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted"
        >
          {dense ? <LayoutGrid className="h-[18px] w-[18px]" /> : <List className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading products…</p>
      ) : (
        <div
          className={
            dense
              ? "flex flex-col gap-1.5"
              : "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
          }
        >
          {filtered.map((p) =>
            dense ? (
              <button
                key={p.id}
                onClick={() => pickProduct(p)}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-left"
              >
                <ProductThumb name={p.name} imageUrl={p.imageUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{p.name}</span>
                  <span className="block truncate text-[11px] font-medium text-muted-2">
                    {p.category}
                  </span>
                </span>
                <span className="tabular-nums shrink-0 text-sm font-bold text-accent">
                  {money(p.price)}
                </span>
              </button>
            ) : (
              <button
                key={p.id}
                onClick={() => pickProduct(p)}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-left"
              >
                <div className="aspect-square w-full overflow-hidden">
                  <ProductThumb name={p.name} imageUrl={p.imageUrl} shape="rounded-none" />
                </div>
                <div className="flex flex-1 flex-col justify-between gap-0.5 p-2">
                  <span className="line-clamp-2 text-[13px] font-semibold leading-tight">
                    {p.name}
                  </span>
                  <span className="tabular-nums text-[13px] font-bold text-accent">
                    {money(p.price)}
                  </span>
                </div>
              </button>
            ),
          )}
          {filtered.length === 0 && (
            <p className="col-span-full py-8 text-center text-muted">
              {search ? `Nothing matches “${search.trim()}”.` : "No products in this category yet."}
            </p>
          )}
        </div>
      )}

      {/* Always reachable, never in the way: the count and running total are
          on the button, so hiding the basket doesn't hide what is in it. */}
      {cart.length > 0 && !basketOpen && (
        <button
          onClick={() => setBasketOpen(true)}
          className="fixed bottom-[72px] right-4 z-20 flex min-h-[56px] items-center gap-3 rounded-2xl bg-accent pl-4 pr-5 text-white shadow-[0_8px_24px_-6px_rgba(37,99,235,0.7)]"
        >
          <span className="relative">
            <ShoppingBasket className="h-6 w-6" />
            <span className="tabular-nums absolute -right-2.5 -top-2 min-w-[20px] rounded-full bg-white px-1 text-center text-[11px] font-extrabold leading-[18px] text-accent">
              {cartCount}
            </span>
          </span>
          <span className="tabular-nums text-base font-extrabold">{money(total)}</span>
        </button>
      )}

      {/* The basket is a sheet, not a permanent panel. On a small tablet the
          old bottom drawer ate half the screen, which is exactly the half a
          shop with three hundred products needs for the grid. */}
      {basketOpen && cart.length > 0 && (
        <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
          <div className="mx-auto flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl bg-surface p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-extrabold">Basket</h3>
                <p className="text-sm font-medium text-muted">
                  {cartCount} item{cartCount === 1 ? "" : "s"} · {money(total)}
                </p>
              </div>
              <button
                onClick={() => setBasketOpen(false)}
                className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
              >
                Keep adding
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {cart.map((l) => (
                <div key={l.productId} className="flex items-center gap-2.5">
                  {/* The whole row opens the line sheet — price and a typed
                      quantity live there; the steppers stay for quick nudges. */}
                  <button
                    onClick={() => setEditingLine(l.productId)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <ProductThumb
                      name={l.name}
                      imageUrl={products.find((p) => p.id === l.productId)?.imageUrl ?? null}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{l.name}</span>
                      <span className="tabular-nums block text-[11px] font-medium text-muted-2">
                        {money(l.price)} each
                        {l.listPrice !== undefined && (
                          <span className="ml-1 font-bold text-warning">
                            was {money(l.listPrice)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setQty(l.productId, l.qty - 1)}
                      className="h-8 w-8 rounded-full border border-border text-lg font-bold"
                    >
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{l.qty}</span>
                    <button
                      onClick={() => setQty(l.productId, l.qty + 1)}
                      className="h-8 w-8 rounded-full border border-border text-lg font-bold"
                    >
                      +
                    </button>
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums font-semibold">
                    {money(l.price * l.qty)}
                  </span>
                </div>
              ))}

              <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-extrabold">
                <span>Total</span>
                <span className="tabular-nums">Rs {total.toFixed(2)}</span>
            </div>

            <button
              onClick={() => setPickingCustomer(true)}
              className="flex items-center justify-between rounded-xl border border-border bg-ground px-3.5 py-2.5 text-left"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-muted-2">
                Customer
              </span>
              <span className="flex items-center gap-2 text-sm font-bold">
                {customer ? customer.name : "Walk-in"}
                {customer && customer.remainingCredit > 0 && (
                  <span className="tabular-nums rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-warning">
                    owes {customer.remainingCredit.toFixed(0)}
                  </span>
                )}
                <span className="text-muted-2">›</span>
              </span>
            </button>

            {/* A typed amount, not just the round-number chips: a customer
                paying 500 against an 800 bill has no chip to press. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-2">Paid</span>
              <input
                value={tender ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setTender(raw === "" ? null : Math.max(0, Number(raw) || 0));
                  setChargeError(null);
                }}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount paid"
                className="tabular-nums h-[50px] flex-1 rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-right text-lg font-extrabold text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="flex gap-2">
              {[total, 500, 1000, 2000].map((amt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setTender(amt);
                    setChargeError(null);
                  }}
                  className={`flex-1 rounded-xl border border-border py-2 text-sm font-semibold ${
                    tender === amt ? "bg-accent text-white" : "bg-ground"
                  }`}
                >
                  {i === 0 ? "Exact" : amt}
                </button>
              ))}
            </div>

            {tender !== null && (
              <div className="tabular-nums flex items-center justify-between rounded-xl bg-ground px-3.5 py-2.5 text-sm font-bold">
                {shortfall > 0 ? (
                  <>
                    <span className="text-warning">Still owing</span>
                    <span className="text-warning">{money(shortfall)}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted">Change</span>
                    <span>{money(change)}</span>
                  </>
                )}
              </div>
            )}

            {chargeError && (
              <p
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger"
              >
                {chargeError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                disabled={charging || tender === null || !(profile?.uid ?? user?.uid)}
                onClick={handleCharge}
                className="min-h-[60px] flex-[2] rounded-2xl bg-success text-lg font-bold text-white disabled:opacity-50"
              >
                {charging ? "Charging…" : "Charge"}
              </button>
              <button
                disabled={charging || !customer || !(profile?.uid ?? user?.uid)}
                onClick={handleCredit}
                className="min-h-[60px] flex-1 rounded-2xl border-[1.5px] border-warning bg-warning/10 text-base font-bold text-warning disabled:opacity-50"
              >
                Credit
              </button>
            </div>
            {!customer && (
              <p className="-mt-1 text-center text-[11px] font-medium text-muted-2">
                Pick a customer to bill on credit, or to leave part of a bill owing
              </p>
            )}
            </div>
          </div>
        </div>
      )}

      {line && (
        <LineSheet
          line={line}
          imageUrl={products.find((p) => p.id === line.productId)?.imageUrl ?? null}
          canEditPrice={canEditPrices}
          onQty={(qty) => setQty(line.productId, qty)}
          onPrice={(price) => setLinePrice(line.productId, price)}
          onRemove={() => removeLine(line.productId)}
          onClose={() => setEditingLine(null)}
        />
      )}

      {confirmingShort !== null && customer && (
        <ShortPaymentConfirm
          customerName={customer.name}
          total={total}
          paid={confirmingShort}
          balanceAfter={round2(customer.remainingCredit + round2(total - confirmingShort))}
          onCancel={() => setConfirmingShort(null)}
          onConfirm={() =>
            completeSale({
              paid: confirmingShort,
              tender: confirmingShort,
              change: 0,
              paymentType: "credit",
            })
          }
        />
      )}

      {pickingCustomer && (
        <CustomerPicker
          selectedId={customer?.id ?? null}
          onPick={(c) => {
            setCustomer(c);
            setChargeError(null);
            setPickingCustomer(false);
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}

      {confirmation && (
        <div
          className={`fixed inset-x-4 z-40 rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-white ${
            cart.length > 0 ? "bottom-[140px]" : "bottom-[72px]"
          }`}
        >
          {confirmation}
          <button onClick={() => setConfirmation(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Tapping a line on the bill opens this. Both fields are typed, not stepped —
 * a cashier selling 12 of something shouldn't press + eleven times, and a
 * haggled price has no natural step at all.
 */
function LineSheet({
  line,
  imageUrl,
  canEditPrice,
  onQty,
  onPrice,
  onRemove,
  onClose,
}: {
  line: BillLine;
  imageUrl: string | null;
  canEditPrice: boolean;
  onQty: (qty: number) => void;
  onPrice: (price: number) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // Held as text so the field can be emptied mid-edit without snapping to 0.
  const [qty, setQty] = useState(String(line.qty));
  const [price, setPrice] = useState(String(line.price));

  const qtyValue = Math.max(0, Number(qty) || 0);
  const priceValue = Math.max(0, Number(price) || 0);
  const lineTotal = round2(qtyValue * priceValue);

  function apply() {
    if (qtyValue <= 0) {
      onRemove();
      return;
    }
    onPrice(priceValue);
    onQty(qtyValue);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumb name={line.name} imageUrl={imageUrl} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-xl font-extrabold">{line.name}</div>
              <div className="text-sm font-medium text-muted">On this bill</div>
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
          Quantity
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
            aria-label="Quantity"
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
          Price each
        </div>
        {canEditPrice ? (
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            aria-label="Price each"
            className="tabular-nums h-[54px] w-full rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground px-4 text-right text-2xl font-extrabold text-ink outline-none focus:border-accent"
          />
        ) : (
          <div className="tabular-nums flex h-[54px] w-full items-center justify-end rounded-2xl bg-ground px-4 text-2xl font-extrabold text-muted">
            {money(line.price)}
          </div>
        )}
        {!canEditPrice && (
          <p className="mt-2 text-xs font-medium text-muted-2">
            Changing a price on the bill isn&apos;t enabled for cashiers — an admin can turn
            on &ldquo;Change a price on the bill&rdquo; in Settings.
          </p>
        )}
        {canEditPrice && line.listPrice !== undefined && (
          <p className="mt-2 text-xs font-bold text-warning">
            Normal price {money(line.listPrice)} — this bill only.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between rounded-xl bg-accent/5 px-3.5 py-3">
          <span className="text-sm font-semibold text-accent">Line total</span>
          <span className="tabular-nums text-lg font-extrabold text-accent">
            {money(lineTotal)}
          </span>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={apply}
            className="min-h-[54px] flex-[2] rounded-2xl bg-accent text-base font-bold text-white"
          >
            Done
          </button>
          <button
            onClick={onRemove}
            className="min-h-[54px] flex-1 rounded-2xl border border-danger/40 text-base font-bold text-danger"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The nod before money is left owing. Shown only when a customer is picked —
 * a walk-in is refused outright, because nobody would be on the hook for it.
 */
function ShortPaymentConfirm({
  customerName,
  total,
  paid,
  balanceAfter,
  onCancel,
  onConfirm,
}: {
  customerName: string;
  total: number;
  paid: number;
  balanceAfter: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const due = round2(total - paid);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-5">
        <h3 className="text-xl font-extrabold">Put {money(due)} on credit?</h3>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
          {customerName} is paying {money(paid)} of a {money(total)} bill. The rest goes on their
          account.
        </p>

        <dl className="tabular-nums mt-4 flex flex-col gap-1.5 rounded-xl bg-ground px-3.5 py-3 text-sm">
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Bill total</dt>
            <dd className="font-bold">{money(total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Paid now</dt>
            <dd className="font-bold">{money(paid)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5">
            <dt className="font-bold text-warning">Owing</dt>
            <dd className="font-extrabold text-warning">{money(due)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Their balance after</dt>
            <dd className="font-bold">{money(balanceAfter)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="min-h-[52px] flex-1 rounded-2xl border border-border text-base font-bold text-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="min-h-[52px] flex-[2] rounded-2xl bg-warning text-base font-bold text-white"
          >
            Confirm credit
          </button>
        </div>
      </div>
    </div>
  );
}

/** Walk-in by default; search, or add a customer without leaving the till. */
function CustomerPicker({
  selectedId,
  onPick,
  onClose,
}: {
  selectedId: string | null;
  onPick: (customer: Customer | null) => void;
  onClose: () => void;
}) {
  const { customers, loading } = useCustomers();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => customers.filter((c) => matchesCustomerSearch(c, search)).slice(0, 40),
    [customers, search],
  );

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-extrabold">Customer</h3>
          <button
            onClick={onClose}
            className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or mobile"
          className="mt-3 w-full rounded-xl border border-border bg-ground px-3.5 py-3 text-base outline-none focus:border-accent"
        />

        <button
          onClick={() => onPick(null)}
          className={`mt-2 flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left ${
            selectedId === null ? "border-accent bg-accent/5" : "border-border"
          }`}
        >
          <span className="text-base font-bold">Walk-in</span>
          <span className="text-xs font-medium text-muted-2">Cash only</span>
        </button>

        {loading ? (
          <p className="py-6 text-center text-muted">Loading…</p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {rows.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left ${
                  selectedId === c.id ? "border-accent bg-accent/5" : "border-border"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-bold">{c.name}</div>
                  <div className="text-xs font-medium text-muted-2">
                    {c.mobileNumber || "No mobile"}
                  </div>
                </div>
                {c.remainingCredit > 0 && (
                  <span className="tabular-nums shrink-0 text-sm font-bold text-warning">
                    owes {c.remainingCredit.toFixed(0)}
                  </span>
                )}
              </button>
            ))}
            {rows.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No customer matches that.</p>
            )}
          </div>
        )}

        <button
          onClick={() => setCreating(true)}
          className="mt-3 min-h-[50px] w-full rounded-xl border border-accent text-sm font-bold text-accent"
        >
          + New customer
        </button>

        {creating && (
          <CustomerSheet
            onClose={() => setCreating(false)}
            onCreated={(customer) => {
              // Pick it straight away — the snapshot hasn't landed yet, so
              // build the customer from what we just wrote.
              onPick({
                ...customer,
                remainingCredit: 0,
                openingBalance: 0,
                active: true,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
