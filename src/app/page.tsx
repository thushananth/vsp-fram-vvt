"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProducts } from "@/lib/firestore/products";
import { useCan, usePermissions } from "@/lib/firestore/permissions";
import { createBill, type CreatedBill } from "@/lib/firestore/bills";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useStoreSettings } from "@/lib/firestore/settings";
import { useCategories } from "@/lib/firestore/categories";
import { ArrowUpDown, LayoutGrid, List, Pencil, Printer, Search, ShoppingBasket, Trash2, X } from "lucide-react";
import CustomerSheet from "@/components/CustomerSheet";
import ProductThumb from "@/components/ui/ProductThumb";
import NumField from "@/components/ui/NumField";
import LineSheet, { type LineEdit } from "@/components/LineSheet";
import ArrangeProducts from "@/components/ArrangeProducts";
import { lineAmount, round2, round3 } from "@/lib/billLines";
import { printTickets, usePrinter } from "@/lib/printer";
import { billTickets, needsCounterCopy, testTicket } from "@/lib/receipts";
import { money } from "@/lib/format";
import type { Bill, BillLine, Customer, PaymentType, Product } from "@/lib/types";

/** How long a bill may stay unacknowledged before the till calls it queued. */
const SYNC_GRACE_MS = 2500;

/** The line as entered by quantity: a typed amount no longer applies. */
function byQty(l: BillLine, qty: number): BillLine {
  const next = { ...l, qty };
  delete next.amount;
  return next;
}

export default function BillingPage() {
  const { products, loading } = useProducts();
  const { categories: allCategories } = useCategories();
  const { profile, user } = useAuth();
  const { settings } = useStoreSettings();
  const { permissions } = usePermissions();
  const printer = usePrinter();
  const [printerBusy, setPrinterBusy] = useState(false);
  /** null = every category. */
  const [categoryId, setCategoryId] = useState<string | null>(null);
  /** This bill only: null follows the store setting, true/false overrides it. */
  const [printThis, setPrintThis] = useState<boolean | null>(null);
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
  /** Admin dragging tiles into the order the till shows them. */
  const [arranging, setArranging] = useState(false);
  const isAdmin = profile?.role === "admin";

  // Its own permission, not the Stock one: a shop may well want a cashier to
  // discount a bun for a regular without letting them reprice the product.
  const canEditPrices = profile?.role === "admin" || permissions.editBillPrices;

  // A shop with 300 products can't be browsed as a grid — typing two or three
  // letters has to be the normal way in, with the category chips as a coarse
  // filter on top. Chips come from Products → Categories, in their set order.
  const categories = useMemo(() => allCategories.filter((c) => c.active), [allCategories]);
  const colorOf = useMemo(
    () => new Map(allCategories.map((c) => [c.id, c.color])),
    [allCategories],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) || (p.barcode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [products, categoryId, search]);

  const total = round2(cart.reduce((sum, l) => sum + lineAmount(l), 0));
  const change = tender !== null ? Math.max(0, round2(tender - total)) : 0;
  /** What would still be owed if the bill were charged at this tender. */
  const shortfall = tender !== null ? Math.max(0, round2(total - tender)) : total;
  const line = cart.find((l) => l.productId === editingLine) ?? null;
  /**
   * A walk-in a little short (Rs 1000 for a 1010 bill) is still a sale: the
   * difference comes off as round-off, up to the limit an admin sets.
   */
  const roundOff =
    !customer && tender !== null && tender > 0 && shortfall > 0 && shortfall <= settings.walkInRoundOff
      ? shortfall
      : 0;
  const printing = printThis ?? settings.printBills;
  const unitOf = (productId: string) => products.find((p) => p.id === productId)?.unit ?? "";
  const counterCopyDue =
    settings.printCounterCopy && needsCounterCopy({ lines: cart }, products, allCategories);
  const cartCount = round3(cart.reduce((sum, l) => sum + l.qty, 0));

  /**
   * Add one of a product to the bill. A product already on the bill keeps the
   * price it was given — re-tapping a discounted line must not quietly put it
   * back to list.
   */
  function addToCart(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? byQty(l, round3(l.qty + 1)) : l));
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          categoryId: p.categoryId,
          qty: 1,
          price: p.price,
          costPrice: p.costPrice,
        },
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

  function setQty(productId: string, rawQty: number) {
    const qty = round3(rawQty);
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.productId !== productId)
        : prev.map((l) => (l.productId === productId ? byQty(l, qty) : l)),
    );
  }

  /**
   * Set a line's quantity, price and (when sold by amount) exact total in one
   * update. The product's own price is left alone — an override is a one-off
   * at the counter, not a price change — but the list price is stamped on the
   * line so the discount is visible later.
   */
  function applyLine(productId: string, edit: LineEdit) {
    const listPrice = products.find((p) => p.id === productId)?.price;
    setCart((prev) =>
      prev.map((l) => {
        if (l.productId !== productId) return l;
        const next: BillLine = { ...l, qty: edit.qty, price: edit.price };
        // Back at list price, the override marker comes off again — but the
        // cost stays, because profit still has to be measurable.
        if (listPrice === undefined || edit.price === listPrice) delete next.listPrice;
        else next.listPrice = listPrice;
        // Never written as undefined: Firestore refuses undefined fields.
        if (edit.amount === undefined) delete next.amount;
        else next.amount = edit.amount;
        return next;
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
      if (roundOff > 0) {
        void completeSale({ paid: tender, tender, change: 0, paymentType: "cash", discount: roundOff });
        return;
      }
      setChargeError(
        settings.walkInRoundOff > 0
          ? `Short by ${money(shortfall)} — a walk-in can be up to ${money(settings.walkInRoundOff)} short. Take the rest, or pick a customer to put it on credit.`
          : `Short by ${money(shortfall)}. A walk-in has to pay in full — take the rest, or pick a customer to put ${money(shortfall)} on credit.`,
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
    /** Walk-in round-off, taken off the total. */
    discount?: number;
  }) {
    const cashierId = profile?.uid ?? user?.uid;
    if (cart.length === 0 || !cashierId) return;
    setCharging(true);
    setConfirmingShort(null);
    // Snapshot the cart and customer for the receipt — state is cleared on success.
    const soldLines = cart;
    const soldTo = customer;
    const discount = round2(payment.discount ?? 0);
    const billTotal = round2(total - discount);
    const due = round2(billTotal - payment.paid);
    const shouldPrint = printing;
    const withCounterCopy = counterCopyDue;
    try {
      const result = createBill({
        lines: soldLines,
        total: billTotal,
        discount,
        paid: payment.paid,
        tender: payment.tender,
        change: payment.change,
        cashierId,
        paymentType: payment.paymentType,
        customerId: soldTo?.id ?? null,
        customerName: soldTo?.name ?? null,
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

      setPrintThis(null);

      if (!shouldPrint) return;

      const sold: Bill = {
        id: result.id,
        no: result.no,
        createdAt: Date.now(),
        cashierId,
        lines: soldLines,
        total: billTotal,
        tender: payment.tender,
        change: payment.change,
        status: "paid",
        synced: false,
        customerId: soldTo?.id ?? null,
        customerName: soldTo?.name ?? null,
        paymentType: payment.paymentType,
        paid: payment.paid,
        due,
        discount,
      };
      // Fire-and-forget: the WebUSB picker can block for as long as the
      // cashier takes to answer it, and Charge must stay usable meanwhile.
      printTickets(
        billTickets(sold, {
          paperWidth: settings.paperWidth,
          unitOf,
          cashierName: profile?.name,
          previousBalance: soldTo ? soldTo.remainingCredit : undefined,
          withCounterCopy,
        }),
      )
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

  async function handlePrinterAction() {
    setPrinterBusy(true);
    const result =
      printer.status === "connected"
        ? await printTickets([testTicket(settings.paperWidth)])
        : await printer.connect();
    setPrinterBusy(false);
    if (!result.success) {
      setConfirmation(`Printer: ${result.error}`);
    } else if (printer.status === "connected") {
      setConfirmation("Test receipt sent to the printer");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-3 pb-28">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
        <Printer className="h-4 w-4 shrink-0 text-muted" />
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            printer.status === "connected" ? "bg-success" : printer.status === "checking" ? "bg-muted-2" : "bg-danger"
          }`}
        />
        <span className="min-w-0 flex-1 truncate">
          {printer.status === "connected"
            ? `Printer connected · ${printer.name}`
            : printer.status === "unsupported"
              ? "Printing needs Chrome or Edge (WebUSB)"
              : printer.status === "checking"
                ? "Checking printer…"
                : "Printer not connected"}
          {!settings.printBills && <span className="text-muted"> · auto-print off</span>}
        </span>
        {(printer.status === "connected" || printer.status === "disconnected") && (
          <button
            onClick={handlePrinterAction}
            disabled={printerBusy}
            className={`shrink-0 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50 ${
              printer.status === "connected" ? "border border-border text-muted" : "bg-accent text-white"
            }`}
          >
            {printerBusy ? "…" : printer.status === "connected" ? "Test print" : "Connect"}
          </button>
        )}
      </div>

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
        <div className="flex flex-1 gap-2 overflow-x-auto pb-0.5">
          <button
            onClick={() => setCategoryId(null)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              categoryId === null ? "bg-ink text-white" : "border border-border bg-surface text-muted"
            }`}
          >
            All
          </button>
          {categories.map((c) => {
            const on = categoryId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setCategoryId(on ? null : c.id)}
                style={on ? { backgroundColor: c.color, borderColor: c.color } : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
                  on ? "text-white" : "border-border bg-surface text-ink"
                }`}
              >
                {!on && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
                {c.name}
              </button>
            );
          })}
        </div>
        {/* Photos help pick a bun by sight; a list fits far more of a
            three-hundred-item catalogue on a small screen. Both are useful, so
            the cashier chooses. */}
        {isAdmin && (
          <button
            onClick={() => {
              setSearch("");
              setArranging(true);
            }}
            aria-label="Arrange products"
            title="Arrange products — drag them into the order the till shows"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted"
          >
            <ArrowUpDown className="h-[18px] w-[18px]" />
          </button>
        )}
        <button
          onClick={() => setDense((d) => !d)}
          aria-label={dense ? "Show photos" : "Show a compact list"}
          title={dense ? "Show photos" : "Show a compact list"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted"
        >
          {dense ? <LayoutGrid className="h-[18px] w-[18px]" /> : <List className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {arranging ? (
        <ArrangeProducts
          products={products}
          visibleIds={filtered.map((p) => p.id)}
          colorOf={colorOf}
          dense={dense}
          onDone={(message) => {
            setArranging(false);
            if (message) setConfirmation(message);
          }}
        />
      ) : loading ? (
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
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left"
              >
                <span
                  className="h-8 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorOf.get(p.categoryId) ?? "#94a3b8" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{p.name}</span>
                  <span className="block truncate text-[11px] font-medium text-muted-2">{p.category}</span>
                </span>
                <span className="tabular-nums shrink-0 text-sm font-bold text-ink">
                  {money(p.price)}
                  <span className="text-[11px] font-semibold text-muted-2"> /{p.unit}</span>
                </span>
              </button>
            ) : (
              <button
                key={p.id}
                onClick={() => pickProduct(p)}
                className="relative flex min-h-[96px] flex-col justify-between gap-2 overflow-hidden rounded-2xl border border-border bg-surface p-3 pt-4 text-left transition-transform active:scale-[0.97]"
              >
                <span
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: colorOf.get(p.categoryId) ?? "#94a3b8" }}
                />
                <span className="line-clamp-2 text-[14px] font-bold leading-tight">{p.name}</span>
                <span className="tabular-nums text-[14px] font-extrabold text-ink">
                  {money(p.price)}
                  <span className="text-[11px] font-semibold text-muted-2"> /{p.unit}</span>
                </span>
              </button>
            ),
          )}
          {filtered.length === 0 && (
            <p className="col-span-full py-8 text-center text-muted">
              {search
                ? `Nothing matches “${search.trim()}”.`
                : products.length === 0
                  ? "No products yet — add them under Products."
                  : "No products in this category yet."}
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
                <div key={l.productId} className="rounded-2xl border border-border p-2.5">
                  {/* Tapping the item opens its sheet too — Edit is there for
                      anyone who doesn't know that. */}
                  <button
                    onClick={() => setEditingLine(l.productId)}
                    className="flex w-full min-w-0 items-center gap-2.5 text-left"
                  >
                    <ProductThumb
                      name={l.name}
                      imageUrl={products.find((p) => p.id === l.productId)?.imageUrl ?? null}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{l.name}</span>
                      <span className="tabular-nums block text-[11px] font-medium text-muted-2">
                        {money(l.price)} each
                        {l.listPrice !== undefined && (
                          <span className="ml-1 font-bold text-warning">
                            was {money(l.listPrice)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="tabular-nums shrink-0 text-right text-base font-extrabold">
                      {money(lineAmount(l))}
                    </span>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => setQty(l.productId, l.qty - 1)}
                      aria-label={`One less ${l.name}`}
                      className="h-9 w-9 rounded-full border border-border text-lg font-bold"
                    >
                      −
                    </button>
                    <span className="tabular-nums min-w-10 text-center text-sm font-bold">
                      {round3(l.qty)}
                      <span className="ml-0.5 text-[11px] font-semibold text-muted-2">{unitOf(l.productId)}</span>
                    </span>
                    <button
                      onClick={() => setQty(l.productId, l.qty + 1)}
                      aria-label={`One more ${l.name}`}
                      className="h-9 w-9 rounded-full border border-border text-lg font-bold"
                    >
                      +
                    </button>
                    <span className="flex-1" />
                    <button
                      onClick={() => setEditingLine(l.productId)}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => removeLine(l.productId)}
                      aria-label={`Delete ${l.name} from the bill`}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-danger/40 px-3 text-xs font-bold text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
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
                {customer && customer.advance > 0 && (
                  <span className="tabular-nums rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-bold text-success">
                    advance {customer.advance.toFixed(0)}
                  </span>
                )}
                <span className="text-muted-2">›</span>
              </span>
            </button>

            {/* A typed amount, not just the round-number chips: a customer
                paying 500 against an 800 bill has no chip to press. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-2">Paid</span>
              <NumField
                value={tender === null ? "" : String(tender)}
                onValue={(raw) => {
                  setTender(raw === "" ? null : Math.max(0, Number(raw) || 0));
                  setChargeError(null);
                }}
                placeholder="0.00"
                aria-label="Amount paid"
                className="tabular-nums h-[50px] flex-1 rounded-xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-right text-lg font-extrabold text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="flex gap-2">
              {[total, 1000, 2000, 5000].map((amt, i) => (
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
                {roundOff > 0 ? (
                  <>
                    <span className="text-accent">Round-off · bill becomes {money(round2(total - roundOff))}</span>
                    <span className="text-accent">−{money(roundOff)}</span>
                  </>
                ) : shortfall > 0 ? (
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

            {/* Skip the printout for this one bill — the store setting is the
                default, this is the exception. */}
            <button
              type="button"
              role="switch"
              aria-checked={printing}
              onClick={() => setPrintThis(!printing)}
              className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-2.5 text-left"
            >
              <Printer className={`h-[18px] w-[18px] shrink-0 ${printing ? "text-accent" : "text-muted-2"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{printing ? "Print receipt" : "Don't print"}</span>
                <span className="block text-[11px] font-medium text-muted-2">
                  {printing
                    ? counterCopyDue
                      ? "Customer receipt + counter copy"
                      : "Customer receipt"
                    : "Bill is saved — reprint it from Bills any time"}
                </span>
              </span>
              <span
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${printing ? "bg-accent" : "bg-border"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${printing ? "translate-x-[22px]" : "translate-x-0.5"}`}
                />
              </span>
            </button>

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
          key={line.productId}
          line={line}
          unit={unitOf(line.productId)}
          imageUrl={products.find((p) => p.id === line.productId)?.imageUrl ?? null}
          canEditPrice={canEditPrices}
          onApply={(edit) => applyLine(line.productId, edit)}
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
  const { can } = useCan();
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
                {c.advance > 0 && (
                  <span className="tabular-nums shrink-0 text-sm font-bold text-success">
                    +{c.advance.toFixed(0)} adv.
                  </span>
                )}
              </button>
            ))}
            {rows.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No customer matches that.</p>
            )}
          </div>
        )}

        {can("addCustomers") && (
          <button
            onClick={() => setCreating(true)}
            className="mt-3 min-h-[50px] w-full rounded-xl border border-accent text-sm font-bold text-accent"
          >
            + New customer
          </button>
        )}

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
                advance: 0,
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
