"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { createBill } from "@/lib/firestore/bills";
import { useProducts } from "@/lib/firestore/products";
import { useCategories } from "@/lib/firestore/categories";
import { useStoreSettings } from "@/lib/firestore/settings";
import { usePermissions } from "@/lib/firestore/permissions";
import { useCustomer } from "@/lib/firestore/customers";
import { useAuth } from "@/lib/auth";
import { useCustomerLabel } from "@/lib/customerName";
import { lineAmount, round2, round3 } from "@/lib/billLines";
import { money } from "@/lib/format";
import { printTickets } from "@/lib/printer";
import { billTickets, needsCounterCopy } from "@/lib/receipts";
import {
  DELIVERY_LINE_NAME,
  DELIVERY_PRODUCT_ID,
  nextBillId,
  orderLabel,
  qtyText,
  shortDate,
} from "@/lib/orders";
import PadSheet from "@/components/orders/PadSheet";
import type { Bill, BillLine, Order } from "@/lib/types";

interface OutLine {
  key: string;
  productId: string;
  name: string;
  unit: string;
  categoryId?: string;
  bookedQty: number;
  bookedPrice: number;
  /** Today's list price, when the product still exists. */
  listPrice: number | null;
  costPrice?: number;
  qty: number;
  price: number;
}

type Pad = { kind: "qty" | "price"; key: string } | { kind: "charge" };

/**
 * Delivery day: weigh what is going, check the prices, and send it out. One
 * write makes the OR- bill (on credit, under the order's number) and moves
 * the order to "out", so it works offline like a till sale. Payment is then
 * taken from Credit as for any credit bill.
 *
 * Each line starts at today's list price. If that differs from the price the
 * order was booked at, the line is flagged; an admin, or a cashier allowed to
 * change bill prices, can type the price to charge.
 */
export default function SendOutSheet({
  order,
  onClose,
  onSent,
}: {
  order: Order;
  onClose: () => void;
  onSent: (message: string, error?: boolean) => void;
}) {
  const { profile, user } = useAuth();
  const { products } = useProducts({ includeInactive: true });
  const { categories } = useCategories();
  const { settings } = useStoreSettings();
  const { permissions } = usePermissions();
  const { label } = useCustomerLabel();
  const customer = useCustomer(order.customerId);
  const isAdmin = profile?.role === "admin";
  const canEditPrices = isAdmin || permissions.editBillPrices;

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [lines, setLines] = useState<OutLine[]>(() =>
    order.lines.map((l, i) => {
      const p = products.find((x) => x.id === l.productId);
      return {
        key: `o${i}`,
        productId: l.productId,
        name: l.name,
        unit: l.unit,
        categoryId: l.categoryId ?? p?.categoryId,
        bookedQty: l.qty,
        bookedPrice: l.price,
        listPrice: p ? p.price : null,
        costPrice: p?.costPrice,
        qty: l.qty,
        price: p ? p.price : l.price,
      };
    }),
  );
  const [charge, setCharge] = useState(order.deliveryCharge);
  const [pad, setPad] = useState<Pad | null>(null);
  const [print, setPrint] = useState(settings.printBills);
  const [sending, setSending] = useState(false);
  // A second tap before the re-render would queue the same send-out twice;
  // the server would then refuse the copy and park it under Bills → Held.
  const sentRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Products may arrive after the sheet opened (cold cache): fill in list
  // prices for lines that had none, without touching anything already typed.
  const priced = lines.map((l) => {
    if (l.listPrice !== null) return l;
    const p = productById.get(l.productId);
    return p ? { ...l, listPrice: p.price, costPrice: p.costPrice, price: p.price } : l;
  });

  const billLines: BillLine[] = priced.map((l) => {
    const line: BillLine = { productId: l.productId, name: l.name, qty: round3(l.qty), price: round2(l.price) };
    if (l.categoryId) line.categoryId = l.categoryId;
    if (l.costPrice !== undefined) line.costPrice = l.costPrice;
    if (l.listPrice !== null && l.price !== l.listPrice) line.listPrice = l.listPrice;
    return line;
  });
  if (charge > 0) {
    billLines.push({ productId: DELIVERY_PRODUCT_ID, name: DELIVERY_LINE_NAME, qty: 1, price: round2(charge), costPrice: 0 });
  }
  const total = round2(billLines.reduce((s, l) => s + lineAmount(l), 0));
  const changedPrices = priced.filter((l) => l.listPrice !== null && l.listPrice !== l.bookedPrice);

  function send() {
    const cashierId = profile?.uid ?? user?.uid;
    if (!cashierId || priced.length === 0 || sentRef.current) return;
    sentRef.current = true;
    setSending(true);
    setError(null);
    try {
      const result = createBill({
        lines: billLines,
        total,
        tender: 0,
        change: 0,
        cashierId,
        paymentType: "credit",
        customerId: order.customerId,
        customerName: order.customerName,
        paid: 0,
        discount: 0,
        advanceUsed: 0,
        order: { orderId: order.id, billId: nextBillId(order), orderNo: order.orderNo },
      });

      const no = orderLabel(order.orderNo);
      onSent(`${no} sent out · ${money(total)} on ${label(order.customerName)}'s account`);
      result.accepted.catch((err: Error) =>
        onSent(`${no} was REFUSED by the server (${err.message}). Open Bills → Held to re-send it.`, true),
      );

      if (print) {
        const sold: Bill = {
          id: result.id,
          no: order.orderNo,
          createdAt: result.createdAt,
          cashierId,
          lines: billLines,
          total,
          tender: 0,
          change: 0,
          status: "paid",
          synced: false,
          customerId: order.customerId,
          customerName: order.customerName,
          paymentType: "credit",
          paid: 0,
          due: total,
          discount: 0,
          advanceUsed: 0,
          kind: "order",
          orderId: order.id,
        };
        printTickets(
          billTickets(sold, {
            paperWidth: settings.paperWidth,
            unitOf: (id) => (id === DELIVERY_PRODUCT_ID ? "" : (productById.get(id)?.unit ?? "")),
            cashierName: profile?.name,
            previousBalance: customer?.remainingCredit,
            withCounterCopy: settings.printCounterCopy && needsCounterCopy(sold, products, categories),
          }),
        )
          .then((r) => {
            if (!r.success) onSent(`${no} sent out. Printing failed (${r.error})`, true);
          })
          .catch(() => {});
      }
    } catch (err) {
      sentRef.current = false;
      setError((err as Error).message);
      setSending(false);
    }
  }

  const padLine = pad && pad.kind !== "charge" ? priced.find((l) => l.key === pad.key) : undefined;
  const update = (key: string, patch: Partial<OutLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-3xl bg-surface sm:max-h-[92dvh] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Send out</div>
            <h2 className="truncate text-xl font-extrabold">
              {orderLabel(order.orderNo)} · {label(order.customerName)}
            </h2>
            <p className="text-sm font-medium text-muted">For {shortDate(order.deliveryDate)} · goes on their account</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {changedPrices.length > 0 && (
            <div className="flex gap-2.5 rounded-2xl border border-warning/40 bg-warning/5 px-3.5 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="font-semibold">
                {changedPrices.length === 1 ? "1 price has" : `${changedPrices.length} prices have`} changed since this
                order was booked. Today&apos;s price is filled in.
                {canEditPrices ? " Tap a price to charge something else." : " Ask an admin if it should be different."}
              </p>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {priced.map((l) => {
              const moved = l.listPrice !== null && l.listPrice !== l.bookedPrice;
              return (
                <li key={l.key} className={`rounded-2xl border px-3.5 py-3 ${moved ? "border-warning/50" : "border-border"}`}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-bold">{l.name}</div>
                      <div className="tabular-nums text-xs font-medium text-muted">
                        Booked {qtyText(l.bookedQty, l.unit)} @ {money(l.bookedPrice)}
                        {moved && <span className="font-bold text-warning"> · today {money(l.listPrice!)}</span>}
                      </div>
                    </div>
                    {priced.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Leave out ${l.name}`}
                        onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-2 active:bg-ground"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPad({ kind: "qty", key: l.key })}
                      className="tabular-nums min-h-[48px] rounded-xl bg-ground px-3 text-left"
                    >
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-2">Weighed</span>
                      <span className="text-base font-extrabold">{qtyText(l.qty, l.unit)}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canEditPrices}
                      onClick={() => setPad({ kind: "price", key: l.key })}
                      className="tabular-nums min-h-[48px] rounded-xl bg-ground px-3 text-left disabled:cursor-default"
                    >
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-2">
                        Price{l.unit ? `/${l.unit}` : ""}
                      </span>
                      <span className="text-base font-extrabold">{money(l.price)}</span>
                    </button>
                    <span className="tabular-nums min-w-[92px] text-right text-base font-extrabold">
                      {money(lineAmount({ qty: round3(l.qty), price: round2(l.price) }))}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={!canEditPrices}
            onClick={() => setPad({ kind: "charge" })}
            className="tabular-nums flex min-h-[52px] items-center justify-between rounded-2xl border border-border px-4 text-left disabled:cursor-default"
          >
            <span className="font-semibold text-muted">{DELIVERY_LINE_NAME}</span>
            <span className="text-base font-extrabold">{charge > 0 ? money(charge) : "None"}</span>
          </button>

          {order.notes && (
            <p className="rounded-xl bg-ground px-3.5 py-2.5 text-sm font-medium">
              <span className="font-bold">Note: </span>
              {order.notes}
            </p>
          )}

          <label className="flex min-h-[48px] items-center gap-3 rounded-xl px-1 text-sm font-semibold">
            <input
              id="sendout-print"
              type="checkbox"
              checked={print}
              onChange={(e) => setPrint(e.target.checked)}
              className="h-5 w-5 accent-[var(--color-accent)]"
            />
            Print the bill
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {error && (
            <p role="alert" className="text-sm font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Bill total</div>
              <div className="tabular-nums text-2xl font-extrabold">{money(total)}</div>
            </div>
            <button
              type="button"
              disabled={sending || priced.length === 0}
              onClick={send}
              className="min-h-[64px] flex-[2] rounded-2xl bg-accent px-5 text-lg font-extrabold text-white disabled:opacity-40"
            >
              {sending ? "Sending…" : `Send out ${orderLabel(order.orderNo)}`}
            </button>
          </div>
        </div>
      </div>

      {pad && pad.kind === "qty" && padLine && (
        <PadSheet
          title={`Weighed · ${padLine.name}`}
          hint={`Booked ${qtyText(padLine.bookedQty, padLine.unit)}`}
          initial={padLine.qty}
          decimals={padLine.unit === "kg" ? 3 : 0}
          suffix={padLine.unit}
          onClose={() => setPad(null)}
          onDone={(qty) => {
            update(padLine.key, { qty });
            setPad(null);
          }}
        />
      )}
      {pad && pad.kind === "price" && padLine && canEditPrices && (
        <PadSheet
          title={`Price · ${padLine.name}`}
          hint={`Booked ${money(padLine.bookedPrice)}${padLine.listPrice !== null ? ` · today ${money(padLine.listPrice)}` : ""}`}
          initial={padLine.price}
          decimals={2}
          prefix="Rs"
          allowZero
          onClose={() => setPad(null)}
          onDone={(price) => {
            update(padLine.key, { price, listPrice: padLine.listPrice });
            setPad(null);
          }}
        />
      )}
      {pad?.kind === "charge" && canEditPrices && (
        <PadSheet
          title={DELIVERY_LINE_NAME}
          hint="0 for none"
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
