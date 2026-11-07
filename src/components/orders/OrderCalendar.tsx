"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useOrders } from "@/lib/firestore/orders";
import { useCustomerLabel } from "@/lib/customerName";
import { localDateKey } from "@/lib/format";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  dateKeyAdd,
  linesSummary,
  longDate,
  monthBounds,
  orderLabel,
  orderPill,
} from "@/lib/orders";
import NavPending from "@/components/NavPending";
import type { Order } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A month of advance orders for the dashboard: how many on each day, a dot
 * per order in its status colour, and the day's list under the grid. Reads one
 * month of orders and nothing else.
 */
export default function OrderCalendar({
  standalone = false,
  onOpen,
}: {
  /** On its own page (/orders/calendar): no "Open Orders" header, bigger grid. */
  standalone?: boolean;
  /** Tap an order in the day's list. */
  onOpen?: (order: Order) => void;
} = {}) {
  const today = localDateKey();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [picked, setPicked] = useState(today);
  const range = useMemo(() => monthBounds(`${month}-01`), [month]);
  const { orders, loading } = useOrders(range);
  // Tomorrow can fall in next month; its own tiny query keeps the strip right.
  const tomorrow = dateKeyAdd(today, 1);
  const { orders: soon } = useOrders(useMemo(() => ({ from: tomorrow, to: tomorrow }), [tomorrow]));
  const { label } = useCustomerLabel();

  const byDay = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      m.set(o.deliveryDate, [...(m.get(o.deliveryDate) ?? []), o]);
    }
    return m;
  }, [orders]);

  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(y, m, 0).getDate();
    const out: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= days; d++) out.push(localDateKey(new Date(y, m - 1, d).getTime()));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = localDateKey(new Date(y, m - 1 + n, 1).getTime());
    setMonth(next.slice(0, 7));
    setPicked(next.slice(0, 7) === today.slice(0, 7) ? today : next);
  };

  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const dayOrders = byDay.get(picked) ?? [];
  const tomorrowCount = soon.filter((o) => o.status === "confirmed").length;
  const monthCount = orders.filter((o) => o.status !== "cancelled").length;

  return (
    <section className={standalone ? "" : "mt-6"} aria-labelledby="order-calendar-title">
      <div className={`mb-2.5 flex items-end justify-between gap-3 ${standalone ? "sr-only" : ""}`}>
        <div>
          <h2 id="order-calendar-title" className="text-[17px] font-bold">
            Orders
          </h2>
          <p className="text-xs font-medium text-muted">
            {tomorrowCount > 0
              ? `${tomorrowCount} ${tomorrowCount === 1 ? "order" : "orders"} for tomorrow`
              : "Nothing booked for tomorrow"}
          </p>
        </div>
        {!standalone && (
          <Link href="/orders" className="relative min-h-[44px] rounded-xl border border-border px-3.5 py-2.5 text-sm font-bold">
            Open Orders
            <NavPending tone="light" />
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <div className="text-base font-extrabold">{monthName}</div>
            <div className="tabular-nums text-xs font-semibold text-muted">
              {loading && orders.length === 0 ? " " : `${monthCount} ${monthCount === 1 ? "order" : "orders"}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-muted"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] font-semibold text-muted">
          {(["confirmed", "out", "delivered"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${ORDER_STATUS_TONE[s].dot}`} />
              {ORDER_STATUS_LABEL[s]}
            </span>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1" role="grid" aria-label={`Orders in ${monthName}`}>
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-2">
              {d}
            </div>
          ))}
          {cells.map((key, i) => {
            if (!key) return <div key={`x${i}`} />;
            const list = byDay.get(key) ?? [];
            const isToday = key === today;
            const isPicked = key === picked;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPicked(key)}
                aria-pressed={isPicked}
                aria-label={`${longDate(key)}, ${list.length} ${list.length === 1 ? "order" : "orders"}`}
                className={`flex aspect-square min-h-[44px] flex-col items-start justify-between rounded-xl border p-1.5 text-left transition-colors sm:p-2 ${
                  isPicked
                    ? "border-accent bg-accent text-white"
                    : isToday
                      ? "border-accent bg-surface ring-1 ring-inset ring-accent"
                      : list.length
                        ? "border-border bg-surface"
                        : "border-transparent bg-ground/60"
                } ${key < today && !isPicked ? "opacity-70" : ""}`}
              >
                <span className="tabular-nums text-xs font-bold sm:text-sm">{Number(key.slice(8))}</span>
                {list.length > 0 && (
                  <span className="flex w-full flex-col items-start gap-1">
                    <span
                      className={`tabular-nums rounded-full px-1.5 text-[11px] font-extrabold leading-4 ${
                        isPicked ? "bg-white/25 text-white" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {list.length}
                    </span>
                    <span className="hidden gap-0.5 sm:flex">
                      {list.slice(0, 5).map((o) => (
                        <span
                          key={o.id}
                          className={`h-1.5 w-1.5 rounded-full ${isPicked ? "bg-white" : orderPill(o).dot}`}
                        />
                      ))}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2" aria-live="polite">
          <h3 className="text-sm font-bold">
            {longDate(picked)} · {dayOrders.length} {dayOrders.length === 1 ? "order" : "orders"}
          </h3>
          {loading && orders.length === 0 ? (
            <div className="skeleton-in flex flex-col gap-1.5">
              <span className="skeleton block h-14 rounded-xl" />
              <span className="skeleton block h-14 rounded-xl" />
            </div>
          ) : dayOrders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm font-medium text-muted">
              No orders for this day.
            </p>
          ) : (
            dayOrders.map((o) => (
              <div
                key={o.id}
                role={onOpen ? "button" : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen ? () => onOpen(o) : undefined}
                onKeyDown={onOpen ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(o)) : undefined}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border border-border px-3 py-2.5 ${
                  onOpen ? "cursor-pointer active:bg-ground" : ""
                }`}
              >
                <span className="tabular-nums text-xs font-bold text-muted">{orderLabel(o.orderNo)}</span>
                <span className="truncate font-bold">{label(o.customerName)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${orderPill(o).pill}`}>
                  {orderPill(o).label}
                </span>
                <span className="col-span-2 col-start-2 truncate text-xs font-medium text-muted">
                  {linesSummary(o.lines)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
