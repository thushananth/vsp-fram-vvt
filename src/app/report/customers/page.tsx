"use client";

import { useCustomerLabel } from "@/lib/customerName";
import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { useBills } from "@/lib/firestore/bills";
import { useCreditPayments } from "@/lib/firestore/credit";
import { useCustomers, isNumberName } from "@/lib/firestore/customers";
import Link from "next/link";
import Stat from "@/components/ui/Stat";
import ReportTabs from "@/components/ReportTabs";
import { usePermissionGate } from "@/components/AdminGate";
import { money, dateAndTime, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import { buildCustomerReport } from "@/lib/customerReport";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

export default function CustomerReportPage() {
  const gate = usePermissionGate("customerReports", "Customer reports", "An admin can turn on “Customer reports” for cashiers under Permissions.");
  const today = todayKey();
  const { customers, loading: customersLoading } = useCustomers();
  const { isAdmin, label } = useCustomerLabel();

  const [rangeMode, setRangeMode] = useState<RangeMode>("thisMonth");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const { bills, loading: billsLoading } = useBills(range);
  const { payments, loading: paymentsLoading } = useCreditPayments(null, range);
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () =>
      buildCustomerReport({
        bills,
        payments,
        customers,
        startMs: range.startMs,
        endMs: range.endMs,
      }),
    [bills, payments, customers, range],
  );

  const q = search.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          !q ||
          ((isAdmin || !isNumberName(r.name)) && r.name.toLowerCase().includes(q)) ||
          (isAdmin && r.mobileNumber.includes(q)),
      ),
    [rows, q, isAdmin],
  );

  const totals = visibleRows.reduce(
    (t, r) => ({
      sales: t.sales + r.total,
      bills: t.bills + r.bills.length,
      credit: t.credit + r.credit,
      received: t.received + r.received,
    }),
    { sales: 0, bills: 0, credit: 0, received: 0 },
  );

  const stats = [
    { label: "Customers", value: String(visibleRows.length), note: "bought or paid in range" },
    { label: "Sales", value: money(totals.sales), note: `${totals.bills} bills` },
    { label: "On credit", value: money(totals.credit), note: "credit bills" },
    { label: "Received", value: money(totals.received), note: "credit payments" },
  ];

  /** The customer's own page, opened on this list's date range. */
  function detailHref(customerId: string): string {
    const q = new URLSearchParams({ id: customerId, range: rangeMode });
    if (rangeMode === "custom") {
      q.set("from", customFrom);
      q.set("to", customTo);
    }
    return `/report/customer?${q.toString()}`;
  }

  const loading = billsLoading || paymentsLoading || customersLoading;

  if (gate) return gate;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <ReportTabs />
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Customer report</h1>
          <p className="text-sm font-medium text-muted">{range.label}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.mode}
            onClick={() => setRangeMode(o.mode)}
            className={`min-h-[40px] flex-1 rounded-lg px-2 text-[13px] font-bold ${
              rangeMode === o.mode ? "bg-white shadow-sm" : "text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {rangeMode === "custom" && (
        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium"
          />
          <span className="text-sm font-semibold text-muted">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium"
          />
        </div>
      )}

      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isAdmin ? "Search customer by name or mobile" : "Search customer by name"}
          className="h-[46px] w-full rounded-xl border border-border bg-surface pl-10 pr-9 text-sm font-medium outline-none focus:border-accent"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-2"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} note={s.note} />
            ))}
          </div>

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Sales by customer</h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
              <div className="w-4" />
              <div className="flex-1">Customer</div>
              <div className="w-12 text-right">Bills</div>
              <div className="w-24 text-right">Purchases</div>
              <div className="hidden w-24 text-right sm:block">Received</div>
            </div>
            {visibleRows.map((r) => {
              return (
                <div key={r.customerId} className="border-t border-[#f1f5f9]">
                  <Link
                    href={detailHref(r.customerId)}
                    className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm active:bg-ground"
                  >
                    <div className="w-4 text-muted-2">
                      <ChevronRight className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{label(r.name)}</div>
                      <div className="truncate text-[11px] font-medium text-muted-2">
                        {isAdmin ? r.mobileNumber || "—" : "—"}
                        {r.lastPurchaseAt > 0 && ` · last ${dateAndTime(r.lastPurchaseAt)}`}
                      </div>
                    </div>
                    <div className="tabular-nums w-12 text-right font-bold">{r.bills.length}</div>
                    <div className="tabular-nums w-24 text-right font-bold">{money(r.total)}</div>
                    <div className="tabular-nums hidden w-24 text-right text-muted-2 sm:block">
                      {money(r.received)}
                    </div>
                  </Link>
                </div>
              );
            })}
            {visibleRows.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">
                {q ? "No customers match your search in this range." : "No customer sales in this range."}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs font-medium text-muted-2">
            Walk-in sales with no customer are not listed here — they are in the Sales report.
          </p>
        </>
      )}
    </div>
  );
}
