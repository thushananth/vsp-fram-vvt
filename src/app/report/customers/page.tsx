"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDown, Printer, Search, X } from "lucide-react";
import { useBills } from "@/lib/firestore/bills";
import { useCreditPayments } from "@/lib/firestore/credit";
import { useCustomers } from "@/lib/firestore/customers";
import { useProducts } from "@/lib/firestore/products";
import { useCategories } from "@/lib/firestore/categories";
import { useUsers } from "@/lib/firestore/users";
import Link from "next/link";
import Stat from "@/components/ui/Stat";
import ReportTabs from "@/components/ReportTabs";
import { usePermissionGate } from "@/components/AdminGate";
import { money, dateAndTime, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import {
  buildCustomerReport,
  downloadCustomerReportPdf,
  localDateKey,
  printCustomerReport,
  type CustomerReportRow,
  type ReportContext,
} from "@/lib/customerReport";

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
  const { bills, loading: billsLoading } = useBills();
  const { payments, loading: paymentsLoading } = useCreditPayments();
  const { customers, loading: customersLoading } = useCustomers();
  const { products } = useProducts();
  const { users } = useUsers();
  const { categories: allCategories } = useCategories();
  // Fills the statement's Item (category) and User (cashier) columns.
  const ctx: ReportContext = useMemo(() => {
    const categories = new Map(products.map((p) => [p.id, p.category]));
    const names = new Map(users.map((u) => [u.uid, u.name]));
    const byId = new Map(allCategories.map((c) => [c.id, c.name]));
    return {
      categoryOf: (id, categoryId) => (categoryId && byId.get(categoryId)) || categories.get(id),
      userName: (uid) => names.get(uid),
    };
  }, [products, users, allCategories]);

  const [rangeMode, setRangeMode] = useState<RangeMode>("thisMonth");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

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
        (r) => !q || r.name.toLowerCase().includes(q) || r.mobileNumber.includes(q),
      ),
    [rows, q],
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

  // The statement's "Date: from —> to" line, as calendar dates.
  const printRange = {
    from: localDateKey(range.startMs),
    to: localDateKey(range.endMs - 1),
  };

  function handlePrint(row: CustomerReportRow) {
    setPopupBlocked(!printCustomerReport(row, printRange, ctx));
  }

  async function handlePdf(row: CustomerReportRow) {
    setPdfError(null);
    try {
      await downloadCustomerReportPdf(row, printRange, ctx);
    } catch (err) {
      setPdfError(`Could not create the PDF (${(err as Error).message}).`);
    }
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
          placeholder="Search customer by name or mobile"
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

      {popupBlocked && (
        <p className="mt-2.5 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm font-semibold text-warning">
          The browser blocked the report window — allow pop-ups for this site and try again.
        </p>
      )}

      {pdfError && (
        <p className="mt-2.5 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-semibold text-danger">
          {pdfError}
        </p>
      )}

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
              const open = openId === r.customerId;
              return (
                <div key={r.customerId} className="border-t border-[#f1f5f9]">
                  <button
                    onClick={() => setOpenId(open ? null : r.customerId)}
                    className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm"
                  >
                    <div className="w-4 text-muted-2">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{r.name}</div>
                      <div className="truncate text-[11px] font-medium text-muted-2">
                        {r.mobileNumber || "—"}
                        {r.lastPurchaseAt > 0 && ` · last ${dateAndTime(r.lastPurchaseAt)}`}
                      </div>
                    </div>
                    <div className="tabular-nums w-12 text-right font-bold">{r.bills.length}</div>
                    <div className="tabular-nums w-24 text-right font-bold">{money(r.total)}</div>
                    <div className="tabular-nums hidden w-24 text-right text-muted-2 sm:block">
                      {money(r.received)}
                    </div>
                  </button>
                  {open && (
                    <CustomerDetail row={r} onPdf={() => handlePdf(r)} onPrint={() => handlePrint(r)} />
                  )}
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

function CustomerDetail({
  row,
  onPdf,
  onPrint,
}: {
  row: CustomerReportRow;
  onPdf: () => Promise<void>;
  onPrint: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const history = [...row.bills, ...row.voidBills].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="border-t border-[#f1f5f9] bg-ground/60 px-3.5 py-3.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Total", value: row.total },
          { label: "Cash", value: row.cash },
          { label: "Credit", value: row.credit },
          { label: "Deleted", value: row.deleted },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">{s.label}</div>
            <div className="tabular-nums text-base font-extrabold">{money(s.value)}</div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="tabular-nums text-xs font-semibold text-muted">
          Received {money(row.received)} · Owes now{" "}
          <span className={row.outstanding > 0 ? "text-danger" : "text-success"}>
            {money(row.outstanding)}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/report/customer?id=${encodeURIComponent(row.customerId)}`}
            className="flex min-h-[40px] items-center rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-accent"
          >
            Full report
          </Link>
          <button
            onClick={onPrint}
            className="min-h-[40px] rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted"
          >
            <Printer className="mr-1.5 inline h-3.5 w-3.5" />
            Print
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onPdf();
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="min-h-[40px] rounded-xl bg-accent px-3.5 text-sm font-bold text-white disabled:opacity-50"
          >
            <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
            {saving ? "Creating…" : "Download PDF"}
          </button>
        </div>
      </div>

      <h3 className="mb-2 mt-4 text-[13px] font-bold uppercase tracking-wider text-muted-2">
        Purchase history
      </h3>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="bg-ground text-[10px] font-bold uppercase tracking-wider text-muted">
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Bill</th>
              <th className="px-3 py-2 text-left">Items</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Type</th>
            </tr>
          </thead>
          <tbody>
            {history.map((b) => (
              <tr key={b.id} className={`border-t border-[#f1f5f9] ${b.status === "void" ? "opacity-50" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{dateAndTime(b.createdAt)}</td>
                <td className="tabular-nums px-3 py-2 font-semibold">#{b.no}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-muted">
                  {b.lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}
                </td>
                <td className="tabular-nums px-3 py-2 text-right font-bold">{money(b.total)}</td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={`inline-block rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      b.status === "void"
                        ? "bg-danger/10 text-danger"
                        : b.paymentType === "credit"
                          ? "bg-warning/10 text-warning"
                          : "bg-success/10 text-success"
                    }`}
                  >
                    {b.status === "void" ? "Deleted" : b.paymentType === "credit" ? "Credit" : "Cash"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {history.length === 0 && (
          <p className="p-4 text-center text-sm text-muted">No purchases in this range.</p>
        )}
      </div>

      {row.payments.length > 0 && (
        <>
          <h3 className="mb-2 mt-4 text-[13px] font-bold uppercase tracking-wider text-muted-2">
            Payments received
          </h3>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {row.payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-t border-[#f1f5f9] px-3 py-2 text-sm first:border-t-0"
              >
                <span className="text-muted">{dateAndTime(p.createdAt)}</span>
                <span className="tabular-nums font-bold text-success">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
