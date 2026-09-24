"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import { useBills, voidBill, retryJournalledBill } from "@/lib/firestore/bills";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { printReceipt } from "@/lib/printer";
import { money, dateAndTime } from "@/lib/format";
import { useBillJournal, type JournalEntry } from "@/lib/billJournal";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import { todayKey } from "@/lib/firestore/bakeryDays";
import Stat from "@/components/ui/Stat";
import {
  billToExportable,
  exportBillsCsv,
  exportBillsJson,
  journalToExportable,
} from "@/lib/exportBills";
import type { Bill } from "@/lib/types";

const FILTERS = ["All", "Paid", "Credit", "Queued"] as const;
type Filter = (typeof FILTERS)[number];

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

const PAGE_SIZES = [25, 50, 100] as const;

export default function BillsPage() {
  const today = todayKey();
  const { bills, loading } = useBills();
  const { profile } = useAuth();
  const { permissions } = usePermissions();
  const [filter, setFilter] = useState<Filter>("All");
  // Today by default — a shop opening Bills mid-shift wants right now, not
  // the whole history. The range picker widens it from there.
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [confirmingVoid, setConfirmingVoid] = useState<Bill | null>(null);
  const journal = useBillJournal();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Bills the server actively refused. They exist only on this device, so they
  // sit above the list until someone re-sends or exports them.
  const held = journal.filter((e) => e.state === "failed");

  const canVoid = profile?.role === "admin" || permissions.voidBills;
  const canReprint = profile?.role === "admin" || permissions.reprintBills;

  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );

  const inRange = useMemo(
    () => bills.filter((b) => b.createdAt >= range.startMs && b.createdAt < range.endMs),
    [bills, range],
  );

  const filtered = useMemo(() => {
    // Queued deliberately ignores the date range — a bill stuck from
    // yesterday is exactly the one a cashier hunting this filter needs to
    // find, not one the range picker should be able to hide.
    let rows = filter === "Queued" ? bills.filter((b) => !b.synced) : inRange;
    if (filter === "Paid") rows = rows.filter((b) => b.status === "paid" && b.synced);
    else if (filter === "Credit") rows = rows.filter((b) => b.paymentType === "credit");

    const needle = search.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(
        (b) =>
          String(b.no).includes(needle) ||
          (b.customerName ?? "").toLowerCase().includes(needle),
      );
    }
    return rows;
  }, [bills, inRange, filter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  // The wide layout always shows something, so it falls back to the first
  // bill on the current page — never one from a page not on screen. The sheet
  // must not fall back at all: it may only appear for a bill actually tapped.
  const opened = paged.find((b) => b.id === selectedId) ?? null;
  const selected = opened ?? paged[0] ?? null;

  // Summary is over the date range, independent of the Paid/Credit/Queued
  // filter and the search box — otherwise narrowing the list would also
  // narrow the totals, and the two would tell different stories at a glance.
  const paidBills = inRange.filter((b) => b.status === "paid");
  const salesTotal = paidBills.reduce((sum, b) => sum + b.total, 0);
  const cashTotal = paidBills.reduce((sum, b) => sum + b.paid, 0);
  // Unscoped by date, same reasoning as the Queued filter above: these are
  // problem counters, not a browsing metric, and the header pill already
  // shows the same all-time number — the two must never disagree.
  const queuedCount = bills.filter((b) => !b.synced).length;
  const dueTotal = inRange.reduce((sum, b) => sum + b.due, 0);
  const voidCount = inRange.filter((b) => b.status === "void").length;

  async function handleVoid(bill: Bill) {
    if (!canVoid) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await voidBill(bill.id);
      setConfirmingVoid(null);
    } catch (err) {
      // Voiding is one of the few writes that genuinely needs the server, so
      // say so rather than leaving the button spinning.
      setVoidError((err as Error).message);
    } finally {
      setVoiding(false);
    }
  }

  async function handleRetry(entry: JournalEntry) {
    setRetryingId(entry.id);
    setRetryError(null);
    try {
      await retryJournalledBill(entry);
    } catch (err) {
      setRetryError((err as Error).message);
    } finally {
      setRetryingId(null);
    }
  }

  /** Exports exactly what the current filter shows — "Queued" gives the
   *  offline takings, "All" gives the whole book. */
  function exportable() {
    return filtered.map(billToExportable);
  }

  function handleReprint(bill: Bill) {
    if (!canReprint) return;
    printReceipt({
      lines: [
        "Bakery POS",
        `Bill #${bill.no}`,
        ...(bill.customerName ? [`Customer: ${bill.customerName}`] : []),
        "--------------------------------",
        ...bill.lines.map(
          (l) => `${l.name}  ${l.qty} x ${money(l.price)}  ${money(l.price * l.qty)}`,
        ),
        "--------------------------------",
        `Total: ${money(bill.total)}`,
        ...(bill.paymentType === "credit"
          ? [`Paid: ${money(bill.paid)}`, `Due: ${money(bill.due)}`]
          : [`Tender: ${money(bill.tender)}`, `Change: ${money(bill.change)}`]),
      ],
      cuts: true,
    }).catch(() => {});
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Bills</h1>
          <p className="text-sm font-medium text-muted">{range.label}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => exportBillsCsv(exportable(), filter.toLowerCase())}
            disabled={filtered.length === 0}
            title="Downloads every bill matching the current range, filter and search — not just this page. Works with no connection."
            className="min-h-[40px] rounded-xl border border-border bg-surface px-3.5 text-[13px] font-bold disabled:opacity-40"
          >
            <Download className="mr-1.5 inline h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => exportBillsJson(exportable(), filter.toLowerCase())}
            disabled={filtered.length === 0}
            title="Full copy of every field, for rebuilding a bill if it is ever needed."
            className="min-h-[40px] rounded-xl border border-border bg-surface px-3 text-[13px] font-bold text-muted disabled:opacity-40"
          >
            JSON
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.mode}
            onClick={() => { setRangeMode(o.mode); setPage(1); }}
            className={`min-h-[40px] rounded-xl px-3.5 text-[13px] font-bold ${
              rangeMode === o.mode
                ? "bg-accent text-white"
                : "border border-border bg-surface text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {rangeMode === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => { setCustomFrom(e.target.value); setPage(1); }}
            aria-label="From date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
          <span className="text-sm font-bold text-muted-2">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={today}
            onChange={(e) => { setCustomTo(e.target.value); setPage(1); }}
            aria-label="To date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Independent of the Paid/Credit/Queued filter and the search box on
          purpose — narrowing the list below must not also narrow these, or the
          two would tell different stories at a glance. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Bills" value={String(inRange.length)} note={`${voidCount} deleted`} />
        <Stat label="Sales" value={money(salesTotal)} note={`${paidBills.length} paid`} />
        <Stat
          label="Cash collected"
          value={money(cashTotal)}
          note={dueTotal > 0 ? `${money(dueTotal)} still owed` : "fully collected"}
          noteColor={dueTotal > 0 ? "text-warning" : "text-success"}
        />
        <Stat
          label="Queued"
          value={String(queuedCount)}
          note={held.length > 0 ? `${held.length} held` : "syncs when online"}
          noteColor={held.length > 0 ? "text-danger" : queuedCount > 0 ? "text-warning" : "text-success"}
          tone={held.length > 0 ? "warning" : "default"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 basis-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by bill number or customer"
            aria-label="Search bills"
            className="w-full rounded-xl border border-border bg-surface py-3 pl-11 pr-9 text-base outline-none focus:border-accent"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setPage(1); }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-2"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-1 rounded-xl bg-[#e9edf4] p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`min-h-[40px] rounded-lg px-3.5 text-[13px] font-bold ${
                filter === f ? "bg-white shadow-sm" : "text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {held.length > 0 && (
        <section className="rounded-2xl border border-danger/30 bg-danger/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-extrabold text-danger">
                {held.length} bill{held.length === 1 ? "" : "s"} the server refused
              </h2>
              <p className="text-xs font-medium text-muted">
                These are saved on this device only. Re-send them, or export them before
                clearing the browser&apos;s data.
              </p>
            </div>
            <button
              onClick={() => exportBillsCsv(held.map(journalToExportable), "held")}
              className="min-h-[40px] rounded-xl border border-danger/40 px-3.5 text-[13px] font-bold text-danger"
            >
              <Download className="mr-1.5 inline h-3.5 w-3.5" />
              Export held
            </button>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {held.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5"
              >
                <span className="tabular-nums text-sm font-bold">#{entry.no}</span>
                <span className="tabular-nums text-xs font-medium text-muted">
                  {dateAndTime(entry.createdAt)}
                </span>
                <span className="tabular-nums text-sm font-bold">{money(entry.total)}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-danger">
                  {entry.error}
                </span>
                <button
                  onClick={() => handleRetry(entry)}
                  disabled={retryingId === entry.id}
                  className="min-h-[36px] rounded-lg bg-accent px-3 text-[13px] font-bold text-white disabled:opacity-40"
                >
                  {retryingId === entry.id ? "Sending…" : "Re-send"}
                </button>
              </li>
            ))}
          </ul>
          {retryError && (
            <p role="alert" className="mt-2 text-xs font-bold text-danger">
              {retryError}
            </p>
          )}
        </section>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted">Loading bills…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-muted">
          {search ? `Nothing matches “${search.trim()}”.` : "No bills in this range."}
        </p>
      ) : (
        <div className="flex flex-1 gap-3 lg:flex-row flex-col">
          <div className="flex flex-col gap-2 lg:w-[340px] lg:shrink-0">
            {paged.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={`flex items-center gap-2.5 rounded-2xl border bg-surface px-3.5 py-3 text-left ${
                  selected?.id === b.id ? "border-accent" : "border-border"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-base font-bold">#{b.no}</span>
                    {b.customerName && (
                      <span className="truncate text-xs font-semibold text-muted">
                        {b.customerName}
                      </span>
                    )}
                  </div>
                  <div className="tabular-nums text-xs font-medium text-muted">
                    {dateAndTime(b.createdAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular-nums text-base font-bold">{money(b.total)}</div>
                  <span
                    className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      b.status === "void"
                        ? "bg-danger/10 text-danger"
                        : b.due > 0
                          ? "bg-warning/10 text-warning"
                          : b.synced
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning"
                    }`}
                  >
                    {b.status === "void"
                      ? "Deleted"
                      : b.due > 0
                        ? "Credit"
                        : b.synced
                          ? "Paid"
                          : "Queued"}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {selected && (
            <div className="hidden flex-1 rounded-2xl border border-border bg-surface p-5 lg:block">
              <BillDetail
                bill={selected}
                canVoid={canVoid}
                canReprint={canReprint}
                voiding={voiding}
                onVoid={() => setConfirmingVoid(selected)}
                onReprint={() => handleReprint(selected)}
              />
            </div>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <span>
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)}{" "}
              of {filtered.length}
            </span>
            <label className="flex items-center gap-1.5">
              <span>Per page</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]); setPage(1); }}
                className="min-h-[36px] rounded-lg border border-border bg-surface px-2 text-xs font-bold outline-none focus:border-accent"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous page"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums px-1 text-xs font-bold text-muted">
              {currentPage} / {pageCount}
            </span>
            <button
              onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
              disabled={currentPage >= pageCount}
              aria-label="Next page"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Tablet: the receipt comes up over the list rather than under it. */}
      {opened && (
        <div className="fixed inset-0 z-30 flex items-end bg-ink/50 lg:hidden">
          <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
            <BillDetail
              bill={opened}
              canVoid={canVoid}
              canReprint={canReprint}
              voiding={voiding}
              onVoid={() => setConfirmingVoid(opened)}
              onReprint={() => handleReprint(opened)}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      )}

      {confirmingVoid && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center">
          <div className="mx-auto w-full max-w-sm rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
            <h3 className="text-lg font-extrabold">Delete bill #{confirmingVoid.no}?</h3>
            <p className="mt-1.5 text-sm font-medium text-muted">
              This marks the bill as void and cannot be undone. The receipt stays on record but no
              longer counts toward sales.
            </p>
            {voidError && (
              <p role="alert" className="mt-3 text-xs font-bold text-danger">
                {voidError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setConfirmingVoid(null); setVoidError(null); }}
                disabled={voiding}
                className="min-h-[48px] flex-1 rounded-xl border border-border text-sm font-bold text-muted disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleVoid(confirmingVoid)}
                disabled={voiding}
                className="min-h-[48px] flex-1 rounded-xl bg-danger text-sm font-bold text-white disabled:opacity-40"
              >
                {voiding ? "Deleting…" : "Delete bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One receipt. Rendered twice — as the side panel on a wide screen, and as a
 * sheet on a tablet, where stacking it under a long list meant scrolling past
 * every bill to read the one just tapped.
 */
function BillDetail({
  bill,
  canVoid,
  canReprint,
  voiding,
  onVoid,
  onReprint,
  onClose,
}: {
  bill: Bill;
  canVoid: boolean;
  canReprint: boolean;
  voiding: boolean;
  onVoid: () => void;
  onReprint: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-2">
            Receipt
          </div>
          <div className="tabular-nums mt-0.5 text-xl font-extrabold">#{bill.no}</div>
          <div className="tabular-nums text-xs font-medium text-muted">
            {dateAndTime(bill.createdAt)}
          </div>
          {bill.customerName && (
            <div className="mt-1 text-sm font-bold">{bill.customerName}</div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        )}
      </div>
      <div className="my-3.5 h-px bg-[#eef2f7]" />

      <div className="flex gap-2.5 border-b border-[#eef2f7] pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-2">
        <div className="flex-1">Item</div>
        <div className="w-20 text-right">Price each</div>
        <div className="w-9 text-right">Qty</div>
        <div className="w-20 text-right">Amount</div>
      </div>
      {bill.lines.map((l, i) => (
        <div key={i} className="flex gap-2.5 border-b border-[#f4f7fb] py-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{l.name}</div>
            {/* Only set when the cashier overrode it, so its presence
                is the record that a discount was given. */}
            {l.listPrice !== undefined && (
              <div className="tabular-nums text-[11px] font-bold text-warning">
                normally {money(l.listPrice)} · {money(l.listPrice - l.price)} off each
              </div>
            )}
          </div>
          <div className="tabular-nums w-20 text-right text-sm font-semibold">
            {money(l.price)}
          </div>
          <div className="tabular-nums w-9 text-right text-[13px] font-medium text-muted">
            {l.qty}
          </div>
          <div className="tabular-nums w-20 text-right text-sm font-bold">
            {money(l.price * l.qty)}
          </div>
        </div>
      ))}

      <div className="flex items-baseline justify-between pt-3.5">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">Total</div>
        <div className="tabular-nums text-2xl font-extrabold">{money(bill.total)}</div>
      </div>
      {bill.paymentType === "credit" ? (
        <div className="tabular-nums text-right text-xs font-bold text-warning">
          On credit · Paid {money(bill.paid)} ·{" "}
          {bill.due > 0 ? `${money(bill.due)} still due` : "Settled"}
        </div>
      ) : (
        <div className="tabular-nums text-right text-xs font-medium text-muted">
          Tender {money(bill.tender)} · Change {money(bill.change)}
        </div>
      )}

      <div className="mt-5 flex gap-2">
        <button
          disabled={!canReprint}
          onClick={onReprint}
          className="min-h-[52px] flex-1 rounded-xl bg-accent text-[15px] font-bold text-white disabled:opacity-40"
        >
          Reprint
        </button>
        <button
          disabled={!canVoid || bill.status === "void" || voiding}
          onClick={onVoid}
          className="min-h-[52px] flex-1 rounded-xl border border-danger/40 text-[15px] font-bold text-danger disabled:opacity-40"
        >
          {bill.status === "void" ? "Deleted" : "Delete"}
        </button>
      </div>
      {!canVoid && (
        <p className="mt-3 text-xs font-medium text-muted-2">
          Deleting a bill isn&apos;t enabled for cashiers — an admin can turn this on in Settings.
        </p>
      )}
      {!canReprint && (
        <p className="mt-2 text-xs font-medium text-muted-2">
          Reprinting a receipt isn&apos;t enabled for cashiers — an admin can turn this on in
          Settings.
        </p>
      )}

    </>
  );
}
