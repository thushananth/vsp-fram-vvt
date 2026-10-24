"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useProducts } from "@/lib/firestore/products";
import { useCan, usePermissions } from "@/lib/firestore/permissions";
import { createBill, linkBillToCustomer, type CreatedBill } from "@/lib/firestore/bills";
import { useCustomers, matchesCustomerSearch, startCreateCustomer } from "@/lib/firestore/customers";
import { useStoreSettings } from "@/lib/firestore/settings";
import { useCategories } from "@/lib/firestore/categories";
import { ArrowUpDown, LayoutGrid, List, MessageSquare, Pencil, Printer, Search, ShoppingBasket, Trash2, X } from "lucide-react";
import CustomerSheet from "@/components/CustomerSheet";
import ProductThumb from "@/components/ui/ProductThumb";
import SwitchTrack from "@/components/ui/SwitchTrack";
import NumPad, { applyKey, type PadKey } from "@/components/ui/NumPad";
import LineSheet, { type LineEdit } from "@/components/LineSheet";
import ArrangeProducts from "@/components/ArrangeProducts";
import { lineAmount, round2, round3 } from "@/lib/billLines";
import { printTickets, usePrinter } from "@/lib/printer";
import { billTickets, needsCounterCopy, testTicket } from "@/lib/receipts";
import { money } from "@/lib/format";
import { localMobile, normalizeMobile, sendBillSms } from "@/lib/sms";
import type { Bill, BillLine, Customer, PaymentType, Product } from "@/lib/types";

interface Payment {
  paid: number;
  tender: number;
  change: number;
  paymentType: PaymentType;
  /** Walk-in round-off, taken off the total. */
  discount?: number;
}

/** How long a bill may stay unacknowledged before the till calls it queued. */
const SYNC_GRACE_MS = 2500;

/**
 * A line in the basket. Each add is its own line — 1 kg of chicken added twice
 * stays as two 1 kg lines, the way the customer handed them over — so a line is
 * identified by its own key, never by product. The key is local to the till and
 * is not written to the bill.
 */
type CartLine = BillLine & { key: string };

let nextLineKey = 0;
const newLineKey = () => `line-${Date.now()}-${nextLineKey++}`;

/** The line as entered by quantity: a typed amount no longer applies. */
function byQty(l: CartLine, qty: number): CartLine {
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
  /** This bill only: null follows the store's SMS setting, true/false overrides it. */
  const [smsThis, setSmsThis] = useState<boolean | null>(null);
  /** A walk-in sale just charged, waiting on the cashier for a mobile (or Skip). */
  const [walkInAsk, setWalkInAsk] = useState<{ bill: CreatedBill; sms: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tender, setTender] = useState<number | null>(null);
  /**
   * The Paid box as typed on the on-screen pad ("12." mid-entry), and whether
   * the pad is open. The box is not an input, so a phone never throws its own
   * keyboard over the basket. `fresh`: the first key replaces the old amount.
   */
  const [tenderText, setTenderText] = useState<string | null>(null);
  const [payPad, setPayPad] = useState<{ fresh: boolean } | null>(null);
  const [charging, setCharging] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Toast clears itself after 2s; a new message restarts the timer.
  useEffect(() => {
    if (!confirmation) return;
    const t = window.setTimeout(() => setConfirmation(null), 2000);
    return () => window.clearTimeout(t);
  }, [confirmation]);
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
  /** This bill only: take the picked customer's held advance off it. */
  const [useAdvance, setUseAdvance] = useState(true);
  /** A charge waiting on the cashier to confirm the advance taken off it. */
  const [confirmingAdvance, setConfirmingAdvance] = useState<Payment | null>(null);
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
  /**
   * Advance the customer already paid in, taken off this bill unless the
   * cashier says not to. The customer pays only the rest: 2000 bill, 1000
   * held → pay 1000.
   */
  const advanceUsed =
    customer && useAdvance ? round2(Math.min(Math.max(0, customer.advance), total)) : 0;
  /** What the customer still has to hand over. */
  const payable = round2(total - advanceUsed);
  const change = tender !== null ? Math.max(0, round2(tender - payable)) : 0;
  /** What would still be owed if the bill were charged at this tender. */
  const shortfall = tender !== null ? Math.max(0, round2(payable - tender)) : payable;
  const line = cart.find((l) => l.key === editingLine) ?? null;
  /**
   * A walk-in a little short (Rs 1000 for a 1010 bill) is still a sale: the
   * difference comes off as round-off, up to the limit an admin sets.
   */
  const roundOff =
    !customer && tender !== null && tender > 0 && shortfall > 0 && shortfall <= settings.walkInRoundOff
      ? shortfall
      : 0;
  const printing = printThis ?? settings.printBills;
  /** A customer's bill can be texted only with a mobile on record; a walk-in's
   *  only if the till is going to ask them for one. */
  const smsPossible = customer ? normalizeMobile(customer.mobileNumber) !== null : settings.askWalkInMobile;
  const texting = smsPossible && (smsThis ?? settings.sendBillSms);
  const unitOf = (productId: string) => products.find((p) => p.id === productId)?.unit ?? "";
  const counterCopyDue =
    settings.printCounterCopy && needsCounterCopy({ lines: cart }, products, allCategories);
  const cartCount = round3(cart.reduce((sum, l) => sum + l.qty, 0));

  function typeTender(key: PadKey) {
    const text = applyKey(tenderText ?? (tender === null ? "" : String(tender)), key, {
      fresh: payPad?.fresh ?? false,
      decimals: 2,
    });
    setTenderText(text);
    setTender(text === "" || text === "0." ? null : Number(text));
    setPayPad({ fresh: false });
    setChargeError(null);
  }

  // A physical keyboard (or a USB number pad) types into Paid while its pad is open.
  useEffect(() => {
    if (!payPad || !basketOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) typeTender(e.key as PadKey);
      else if (e.key === "." || e.key === ",") typeTender(".");
      else if (e.key === "Backspace") typeTender("back");
      else if (e.key === "Delete") typeTender("clear");
      else if (e.key === "Enter" || e.key === "Escape") setPayPad(null);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // The search box is not focused on load — on a phone that would throw the
  // keyboard up uninvited. A barcode scanner (or a desk keyboard) still lands
  // in it: the first key typed with nothing focused moves into the box.
  const sheetOpen = basketOpen || editingLine !== null || pickingCustomer || arranging || walkInAsk !== null;
  useEffect(() => {
    if (sheetOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      setSearch((prev) => prev + e.key);
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen]);

  /**
   * Add one of a product to the bill as a new line, even when the product is
   * already on it — the cashier adjusts an existing line in the basket.
   * Returns the new line's key.
   */
  function addToCart(p: Product): string {
    const key = newLineKey();
    setCart((prev) => [
      ...prev,
      {
        key,
        productId: p.id,
        name: p.name,
        categoryId: p.categoryId,
        qty: 1,
        price: p.price,
        costPrice: p.costPrice,
      },
    ]);
    return key;
  }

  /**
   * Tapping a tile in the grid adds the product *and* opens its sheet, so the
   * price and quantity can be set in the same movement — a regular getting a
   * bun at 100 instead of 120 shouldn't take two separate taps to arrange.
   * A barcode scan deliberately skips the sheet: that is the fast lane, and a
   * modal on every beep would make scanning unusable.
   */
  function pickProduct(p: Product) {
    setEditingLine(addToCart(p));
  }

  function setQty(key: string, rawQty: number) {
    const qty = round3(rawQty);
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.key !== key)
        : prev.map((l) => (l.key === key ? byQty(l, qty) : l)),
    );
  }

  /**
   * Set a line's quantity, price and (when sold by amount) exact total in one
   * update. The product's own price is left alone — an override is a one-off
   * at the counter, not a price change — but the list price is stamped on the
   * line so the discount is visible later.
   */
  function applyLine(key: string, edit: LineEdit) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const listPrice = products.find((p) => p.id === l.productId)?.price;
        const next: CartLine = { ...l, qty: edit.qty, price: edit.price };
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

  function removeLine(key: string) {
    setCart((prev) => {
      const next = prev.filter((l) => l.key !== key);
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
    // Advance covering the whole bill leaves nothing to hand over.
    const handed = tender ?? (payable === 0 ? 0 : null);
    if (cart.length === 0 || handed === null) return;
    setChargeError(null);
    if (handed >= payable) {
      withAdvanceConfirmed({ paid: payable, tender: handed, change, paymentType: "cash" });
      return;
    }
    if (!customer) {
      if (roundOff > 0) {
        void completeSale({ paid: handed, tender: handed, change: 0, paymentType: "cash", discount: roundOff });
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
      if (tender >= payable) {
        withAdvanceConfirmed({ paid: payable, tender, change, paymentType: "cash" });
      } else {
        setConfirmingShort(tender);
      }
      return;
    }
    withAdvanceConfirmed({
      paid: 0,
      tender: 0,
      change: 0,
      paymentType: payable === 0 ? "cash" : "credit",
    });
  }

  /**
   * A bill paid partly from advance gets a popup first, so the cashier can
   * tell the customer "1000 from your advance, 1000 to pay" before it goes
   * through. Without advance the sale goes straight ahead.
   */
  function withAdvanceConfirmed(payment: Payment) {
    if (advanceUsed > 0) setConfirmingAdvance(payment);
    else completeSale(payment);
  }

  function completeSale(payment: Payment) {
    const cashierId = profile?.uid ?? user?.uid;
    if (cart.length === 0 || !cashierId) return;
    setCharging(true);
    setConfirmingShort(null);
    setConfirmingAdvance(null);
    // Snapshot the cart and customer for the receipt — state is cleared on success.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the key stays on the till
    const soldLines: BillLine[] = cart.map(({ key, ...l }) => l);
    const soldTo = customer;
    const discount = round2(payment.discount ?? 0);
    const billTotal = round2(total - discount);
    const advance = round2(Math.min(advanceUsed, billTotal));
    const due = round2(billTotal - advance - payment.paid);
    const shouldPrint = printing;
    const shouldText = texting;
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
        advanceUsed: advance,
      });

      // The bill is durable the moment createBill returns — it is in the local
      // queue, which survives a reload. Whether the *server* has it yet is a
      // separate, slower question, so the till says "saved" now and upgrades
      // the message when the acknowledgement (or the timeout) arrives.
      setConfirmation(
        due > 0
          ? `Bill #${result.no} saved — ${soldTo!.name} owes ${money(due)}`
          : advance > 0
            ? `Bill #${result.no} saved — ${money(advance)} taken from ${soldTo!.name}'s advance`
            : `Bill #${result.no} saved`,
      );
      trackSync(result);
      if (soldTo) {
        if (shouldText) textBill(result);
      } else if (settings.askWalkInMobile) {
        setWalkInAsk({ bill: result, sms: shouldText });
      }
      setCart([]);
      setTender(null);
      setTenderText(null);
      setPayPad(null);
      setCustomer(null);
      setUseAdvance(true);
      setEditingLine(null);
      setBasketOpen(false);
      setChargeError(null);

      setPrintThis(null);
      setSmsThis(null);

      if (!shouldPrint) return;

      const sold: Bill = {
        id: result.id,
        no: result.no,
        createdAt: result.createdAt,
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
        advanceUsed: advance,
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

  /**
   * Text the bill once the server has it — the function reads the bill back,
   * so a bill still in the offline queue would not be found. Never blocks the
   * till; only a failure is worth a toast.
   */
  function textBill(bill: CreatedBill, mobile?: string) {
    bill.accepted.then(
      () =>
        sendBillSms({ billId: bill.id, mobile }).then(
          () => {},
          (err: Error) => setConfirmation(`Bill #${bill.no} — SMS not sent (${err.message})`),
        ),
      // A refused bill was already reported by trackSync — don't bury that under an SMS notice.
      () => {},
    );
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
          ref={searchRef}
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
                <div key={l.key} className="rounded-2xl border border-border p-2.5">
                  {/* Tapping the item opens its sheet too — Edit is there for
                      anyone who doesn't know that. */}
                  <button
                    onClick={() => setEditingLine(l.key)}
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
                      onClick={() => setQty(l.key, l.qty - 1)}
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
                      onClick={() => setQty(l.key, l.qty + 1)}
                      aria-label={`One more ${l.name}`}
                      className="h-9 w-9 rounded-full border border-border text-lg font-bold"
                    >
                      +
                    </button>
                    <span className="flex-1" />
                    <button
                      onClick={() => setEditingLine(l.key)}
                      className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold text-ink"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => removeLine(l.key)}
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
              {advanceUsed > 0 && (
                <>
                  <div className="tabular-nums -mt-2 flex items-center justify-between text-sm font-bold text-success">
                    <span>Advance used</span>
                    <span>−{money(advanceUsed)}</span>
                  </div>
                  <div className="tabular-nums -mt-1 flex items-center justify-between text-lg font-extrabold">
                    <span>To pay</span>
                    <span>{money(payable)}</span>
                  </div>
                </>
              )}

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

            {customer && customer.advance > 0 && (
              <button
                type="button"
                role="switch"
                aria-checked={useAdvance}
                onClick={() => setUseAdvance(!useAdvance)}
                className="tabular-nums flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/5 px-3.5 py-2.5 text-left text-sm font-bold"
              >
                <span className="text-success">
                  {useAdvance
                    ? `Using ${money(round2(Math.min(customer.advance, total)))} of ${money(customer.advance)} advance`
                    : `${money(customer.advance)} advance not used on this bill`}
                </span>
                <span className="shrink-0 text-xs text-muted">{useAdvance ? "Don't use" : "Use it"}</span>
              </button>
            )}

            {/* A typed amount, not just the round-number chips: a customer
                paying 500 against an 800 bill has no chip to press. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-2">Paid</span>
              <button
                type="button"
                onClick={() => setPayPad(payPad ? null : { fresh: true })}
                aria-label="Amount paid"
                aria-expanded={payPad !== null}
                className={`tabular-nums h-[50px] flex-1 rounded-xl border-[1.5px] bg-ground px-3.5 text-right text-lg font-extrabold text-ink ${
                  payPad ? "border-accent" : "border-[#dbe3ee]"
                }`}
              >
                {(tenderText ?? (tender === null ? "" : String(tender))) || (
                  <span className="text-muted-2/70">0.00</span>
                )}
              </button>
            </div>

            {payPad && (
              <div className="flex flex-col gap-2">
                <NumPad onKey={typeTender} />
                <button
                  type="button"
                  onClick={() => setPayPad(null)}
                  className="min-h-[46px] rounded-2xl bg-accent text-sm font-bold text-white"
                >
                  Done
                </button>
              </div>
            )}

            <div className="flex gap-2">
              {[payable, 1000, 2000, 5000].map((amt, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setTender(amt);
                    setTenderText(null);
                    setPayPad(null);
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
              <SwitchTrack on={printing} />
            </button>

            {/* Text the bill — ticked by default from Settings, untick for one bill. */}
            <button
              type="button"
              role="switch"
              aria-checked={texting}
              disabled={!smsPossible}
              onClick={() => setSmsThis(!texting)}
              className="flex items-center gap-3 rounded-xl border border-border px-3.5 py-2.5 text-left disabled:opacity-60"
            >
              <MessageSquare className={`h-[18px] w-[18px] shrink-0 ${texting ? "text-accent" : "text-muted-2"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{texting ? "Send SMS" : "No SMS"}</span>
                <span className="block text-[11px] font-medium text-muted-2">
                  {!smsPossible
                    ? customer
                      ? `${customer.name} has no mobile number on record`
                      : "Walk-in mobile prompt is off in Settings"
                    : texting
                      ? customer
                        ? `Bill texted to ${customer.mobileNumber}`
                        : "Bill texted to the number the walk-in gives"
                      : "Bill won't be texted"}
                </span>
              </span>
              <SwitchTrack on={texting} />
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
                disabled={charging || (tender === null && payable > 0) || !(profile?.uid ?? user?.uid)}
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
          key={line.key}
          line={line}
          unit={unitOf(line.productId)}
          imageUrl={products.find((p) => p.id === line.productId)?.imageUrl ?? null}
          canEditPrice={canEditPrices}
          onApply={(edit) => applyLine(line.key, edit)}
          onRemove={() => removeLine(line.key)}
          onClose={() => setEditingLine(null)}
        />
      )}

      {confirmingShort !== null && customer && (
        <ShortPaymentConfirm
          customerName={customer.name}
          total={total}
          advanceUsed={advanceUsed}
          paid={confirmingShort}
          balanceAfter={round2(customer.remainingCredit + round2(payable - confirmingShort))}
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

      {confirmingAdvance && customer && (
        <AdvanceConfirm
          customerName={customer.name}
          total={total}
          advanceUsed={advanceUsed}
          advanceHeld={customer.advance}
          paid={round2(payable)}
          onCancel={() => setConfirmingAdvance(null)}
          onSkipAdvance={() => {
            setConfirmingAdvance(null);
            setUseAdvance(false);
          }}
          onConfirm={() => completeSale(confirmingAdvance)}
        />
      )}

      {walkInAsk && (
        <WalkInMobileAsk
          billNo={walkInAsk.bill.no}
          sms={walkInAsk.sms}
          onSkip={() => setWalkInAsk(null)}
          onSave={({ mobile, existing, name }) => {
            const { bill, sms } = walkInAsk;
            setWalkInAsk(null);
            let owner = existing ? { id: existing.id, name: existing.name } : null;
            if (!owner) {
              const local = localMobile(mobile);
              const created = startCreateCustomer({
                name: name || local,
                type: "person",
                mobileNumber: local,
                autoNamed: !name,
              });
              created.saved.catch((err: Error) => setConfirmation(`Customer not saved — ${err.message}`));
              owner = { id: created.id, name: name || local };
            }
            // Queued after the customer, so the rules find them when it lands.
            linkBillToCustomer(bill.id, owner).catch((err: Error) =>
              setConfirmation(`Bill #${bill.no} not linked to ${owner.name} — ${err.message}`),
            );
            setConfirmation(
              existing ? `Bill #${bill.no} added to ${owner.name}` : `Saved ${owner.name} — bill #${bill.no} added`,
            );
            if (sms) textBill(bill, mobile);
          }}
        />
      )}

      {pickingCustomer && (
        <CustomerPicker
          selectedId={customer?.id ?? null}
          onPick={(c) => {
            setCustomer(c);
            setUseAdvance(true);
            setChargeError(null);
            setPickingCustomer(false);
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}

      {confirmation && (
        <div
          className="fixed right-4 top-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-lg sm:max-w-sm"
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
 * After a walk-in sale: "your mobile number?" Saving adds them as a person
 * customer (name optional — the till is busy), or picks the customer who
 * already has that number, so they get offers and, when Send SMS was ticked,
 * this bill by text. Always skippable; turned off from Settings → SMS.
 */
function WalkInMobileAsk({
  billNo,
  sms,
  onSkip,
  onSave,
}: {
  billNo: number;
  sms: boolean;
  onSkip: () => void;
  onSave: (save: { mobile: string; existing: Customer | null; name: string }) => void;
}) {
  const { customers } = useCustomers();
  const [digits, setDigits] = useState("");
  const [name, setName] = useState("");
  const mobile = normalizeMobile(digits);

  // Customers whose number has what's typed so far, in the 07X… form it's typed in.
  const withMobile = useMemo(
    () =>
      customers.flatMap((c) => {
        const n = normalizeMobile(c.mobileNumber);
        return n ? [{ customer: c, mobile: n, local: localMobile(n) }] : [];
      }),
    [customers],
  );
  const typedLocal = digits.replace(/^94/, "0");
  const suggestions =
    typedLocal.length >= 3 ? withMobile.filter((m) => m.local.includes(typedLocal)).slice(0, 4) : [];
  const existing = mobile ? (withMobile.find((m) => m.mobile === mobile)?.customer ?? null) : null;

  function press(key: PadKey) {
    if (key === "clear") setDigits("");
    else if (key === "back") setDigits((d) => d.slice(0, -1));
    else if (key !== ".") setDigits((d) => (d.length >= 10 ? d : d + key));
  }

  function save() {
    if (mobile) onSave({ mobile, existing, name: name.trim() });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") return onSkip();
      if (e.key === "Enter") {
        e.preventDefault();
        return save();
      }
      // Typing a name goes into the name box, not the number.
      if (e.target instanceof HTMLInputElement) return;
      if (/^[0-9]$/.test(e.key)) press(e.key as PadKey);
      else if (e.key === "Backspace") press("back");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/60 sm:items-center sm:p-4">
      <div className="max-h-[94vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
        <h3 className="text-xl font-extrabold">Customer&apos;s mobile?</h3>
        <p className="mt-1 text-sm font-medium leading-relaxed text-muted">
          Bill #{billNo} is saved.{" "}
          {sms ? "We'll text the bill and send offers now and then." : "For offers and promotions by SMS."}
        </p>

        <div
          className={`tabular-nums mt-3 rounded-xl border px-3.5 py-3 text-center text-2xl font-extrabold tracking-wider ${
            digits && !mobile ? "border-warning" : mobile ? "border-success" : "border-border"
          }`}
        >
          {digits || <span className="text-muted-2">07X XXX XXXX</span>}
        </div>

        {/* Suggestions as they type — a regular is one tap, never a second customer. */}
        {suggestions.length > 0 && !existing && (
          <div className="mt-2 flex flex-col gap-1">
            {suggestions.map((s) => (
              <button
                key={s.customer.id}
                type="button"
                onClick={() => onSave({ mobile: s.mobile, existing: s.customer, name: "" })}
                className="flex items-center justify-between gap-2 rounded-xl border border-border bg-ground px-3 py-2 text-left"
              >
                <span className="min-w-0 truncate text-sm font-bold">
                  {s.customer.autoNamed ? "Walk-in" : s.customer.name}
                </span>
                <span className="tabular-nums shrink-0 text-sm font-semibold text-muted">{s.local}</span>
              </button>
            ))}
          </div>
        )}

        {existing ? (
          <p className="mt-2 rounded-xl bg-success/10 px-3 py-2 text-sm font-bold text-success">
            Already a customer — {existing.autoNamed ? "walk-in" : existing.name}
          </p>
        ) : (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="mt-2 w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none focus:border-accent"
          />
        )}

        <div className="mt-3">
          <NumPad onKey={press} allowDecimal={false} layout="phone" />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={onSkip}
            className="min-h-[52px] flex-1 rounded-2xl border border-border text-base font-bold text-muted"
          >
            Skip
          </button>
          <button
            disabled={!mobile}
            onClick={save}
            className="min-h-[52px] flex-[2] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
          >
            {existing ? "Use this customer" : "Save customer"}
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
  advanceUsed,
  paid,
  balanceAfter,
  onCancel,
  onConfirm,
}: {
  customerName: string;
  total: number;
  advanceUsed: number;
  paid: number;
  balanceAfter: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const due = round2(total - advanceUsed - paid);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-5">
        <h3 className="text-xl font-extrabold">Put {money(due)} on credit?</h3>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
          {customerName} is paying {money(paid)} of a {money(total)} bill
          {advanceUsed > 0 && <> after {money(advanceUsed)} from their advance</>}. The rest goes on
          their account.
        </p>

        <dl className="tabular-nums mt-4 flex flex-col gap-1.5 rounded-xl bg-ground px-3.5 py-3 text-sm">
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Bill total</dt>
            <dd className="font-bold">{money(total)}</dd>
          </div>
          {advanceUsed > 0 && (
            <div className="flex justify-between text-success">
              <dt className="font-semibold">Advance used</dt>
              <dd className="font-bold">−{money(advanceUsed)}</dd>
            </div>
          )}
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

/**
 * The customer has advance with the shop, so this bill is paid partly from it.
 * Shown before the sale goes through, so the cashier can read the split out —
 * and drop the advance if the customer wants to keep it for later.
 */
function AdvanceConfirm({
  customerName,
  total,
  advanceUsed,
  advanceHeld,
  paid,
  onCancel,
  onSkipAdvance,
  onConfirm,
}: {
  customerName: string;
  total: number;
  advanceUsed: number;
  advanceHeld: number;
  paid: number;
  onCancel: () => void;
  onSkipAdvance: () => void;
  onConfirm: () => void;
}) {
  const left = round2(Math.max(0, advanceHeld - advanceUsed));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-5">
        <h3 className="text-xl font-extrabold">
          {paid > 0 ? `${customerName} pays ${money(paid)}` : "Paid in full from advance"}
        </h3>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
          {customerName} has {money(advanceHeld)} advance with the shop. {money(advanceUsed)} of it
          comes off this {money(total)} bill.
        </p>

        <dl className="tabular-nums mt-4 flex flex-col gap-1.5 rounded-xl bg-ground px-3.5 py-3 text-sm">
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Bill total</dt>
            <dd className="font-bold">{money(total)}</dd>
          </div>
          <div className="flex justify-between text-success">
            <dt className="font-semibold">Advance used</dt>
            <dd className="font-bold">−{money(advanceUsed)}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5">
            <dt className="font-bold">To pay</dt>
            <dd className="font-extrabold">{money(paid)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="font-semibold text-muted">Advance left after</dt>
            <dd className="font-bold">{money(left)}</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="min-h-[52px] rounded-2xl bg-success text-base font-bold text-white"
          >
            Confirm
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="min-h-[46px] flex-1 rounded-2xl border border-border text-sm font-bold text-muted"
            >
              Cancel
            </button>
            <button
              onClick={onSkipAdvance}
              className="min-h-[46px] flex-1 rounded-2xl border border-border text-sm font-bold text-ink"
            >
              Don&apos;t use advance
            </button>
          </div>
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
                lastReminderAt: 0,
                autoNamed: false,
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
