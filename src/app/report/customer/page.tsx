"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileDown, Printer, Search, X } from "lucide-react";
import { useCustomerBills } from "@/lib/firestore/bills";
import { useCreditPayments } from "@/lib/firestore/credit";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useProducts } from "@/lib/firestore/products";
import { useUsers } from "@/lib/firestore/users";
import { todayKey } from "@/lib/firestore/farmDays";
import Stat from "@/components/ui/Stat";
import ReportTabs from "@/components/ReportTabs";
import { usePermissionGate } from "@/components/AdminGate";
import { money, dateAndTime } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import {
  BILL_COLUMNS,
  billLineRows,
  buildCustomerReport,
  downloadCustomerReportPdf,
  emptyCustomerRow,
  groupBillsByDay,
  localDateKey,
  printCustomerReport,
  type ReportContext,
} from "@/lib/customerReport";
import type { Customer } from "@/lib/types";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

// useSearchParams needs a Suspense boundary in a static export build.
export default function IndividualCustomerReportPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-muted">Loading…</p>}>
      <IndividualCustomerReport />
    </Suspense>
  );
}

function IndividualCustomerReport() {
  const gate = usePermissionGate("viewReports", "Reports", "An admin can turn on “View day reports” for cashiers in Settings.");
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  const { customers, loading: customersLoading } = useCustomers();
  const customer = customers.find((c) => c.id === selectedId) ?? null;

  function select(id: string | null) {
    router.replace(id ? `/report/customer?id=${encodeURIComponent(id)}` : "/report/customer");
  }

  if (gate) return gate;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <ReportTabs />
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Customer report</h1>
        <p className="text-sm font-medium text-muted">One customer&apos;s bills, purchases and total</p>
      </div>

      {customersLoading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : customer ? (
        <CustomerStatement customer={customer} onChange={() => select(null)} />
      ) : (
        <CustomerChooser customers={customers} onPick={(c) => select(c.id)} missing={!!selectedId} />
      )}
    </div>
  );
}

function CustomerChooser({
  customers,
  onPick,
  missing,
}: {
  customers: Customer[];
  onPick: (c: Customer) => void;
  missing: boolean;
}) {
  const [search, setSearch] = useState("");
  const matches = customers.filter((c) => matchesCustomerSearch(c, search));

  return (
    <>
      {missing && (
        <p className="mt-3 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm font-semibold text-warning">
          That customer could not be found — choose one below.
        </p>
      )}
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <input
          autoFocus
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

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex gap-2 bg-ground px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">
          <div className="flex-1">Customer</div>
          <div className="w-24 text-right">Owes now</div>
        </div>
        {matches.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c)}
            className="flex w-full items-center gap-2 border-t border-[#f1f5f9] px-3.5 py-3 text-left text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{c.name}</div>
              <div className="truncate text-[11px] font-medium text-muted-2">{c.mobileNumber || "—"}</div>
            </div>
            <div
              className={`tabular-nums w-24 text-right font-bold ${
                c.remainingCredit > 0 ? "text-danger" : "text-muted-2"
              }`}
            >
              {money(c.remainingCredit)}
            </div>
          </button>
        ))}
        {matches.length === 0 && (
          <p className="p-6 text-center text-sm text-muted">
            {search ? "No customers match your search." : "No customers yet."}
          </p>
        )}
      </div>
    </>
  );
}

function CustomerStatement({ customer, onChange }: { customer: Customer; onChange: () => void }) {
  const today = todayKey();
  const { bills, loading: billsLoading } = useCustomerBills(customer.id);
  const { payments, loading: paymentsLoading } = useCreditPayments(customer.id);
  const { products } = useProducts();
  const { users } = useUsers();

  const [rangeMode, setRangeMode] = useState<RangeMode>("thisMonth");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const row = useMemo(
    () =>
      buildCustomerReport({
        bills,
        payments,
        customers: [customer],
        startMs: range.startMs,
        endMs: range.endMs,
      }).find((r) => r.customerId === customer.id) ?? emptyCustomerRow(customer),
    [bills, payments, customer, range],
  );

  const ctx: ReportContext = useMemo(() => {
    const categories = new Map(products.map((p) => [p.id, p.category]));
    const names = new Map(users.map((u) => [u.uid, u.name]));
    return { categoryOf: (id) => categories.get(id), userName: (uid) => names.get(uid) };
  }, [products, users]);

  const printRange = { from: localDateKey(range.startMs), to: localDateKey(range.endMs - 1) };
  const history = [...row.bills, ...row.voidBills];

  async function handlePdf() {
    setMessage(null);
    setSaving(true);
    try {
      await downloadCustomerReportPdf(row, printRange, ctx);
    } catch (err) {
      setMessage(`Could not create the PDF (${(err as Error).message}).`);
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    setMessage(
      printCustomerReport(row, printRange, ctx)
        ? null
        : "The browser blocked the report window — allow pop-ups for this site and try again.",
    );
  }

  const stats = [
    { label: "Total", value: money(row.total), note: `${row.bills.length} bills` },
    { label: "Cash", value: money(row.cash), note: "paid at the till" },
    { label: "Credit", value: money(row.credit), note: "on account" },
    { label: "Deleted", value: money(row.deleted), note: `${row.voidBills.length} voided` },
    { label: "Received", value: money(row.received), note: `${row.payments.length} payments` },
    {
      label: "Owes now",
      value: money(row.outstanding),
      note: "current balance",
      color: row.outstanding > 0 ? "text-danger" : "text-success",
    },
  ];

  const loading = billsLoading || paymentsLoading;

  return (
    <>
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold">{customer.name}</div>
          <div className="truncate text-xs font-medium text-muted-2">
            {customer.mobileNumber || "No mobile"} · {range.label}
          </div>
        </div>
        <button
          onClick={onChange}
          className="min-h-[40px] shrink-0 rounded-xl border border-border px-3 text-sm font-bold text-muted"
        >
          Change
        </button>
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

      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={handlePrint}
          disabled={loading}
          className="min-h-[44px] rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted disabled:opacity-50"
        >
          <Printer className="mr-1.5 inline h-3.5 w-3.5" />
          Print
        </button>
        <button
          onClick={() => void handlePdf()}
          disabled={loading || saving}
          className="min-h-[44px] rounded-xl bg-accent px-3.5 text-sm font-bold text-white disabled:opacity-50"
        >
          <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
          {saving ? "Creating…" : "Download PDF"}
        </button>
      </div>

      {message && (
        <p className="mt-2.5 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-semibold text-danger">
          {message}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} note={s.note} noteColor={s.color} />
            ))}
          </div>

          <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Bills</h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
              No bills for {customer.name} in this range.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groupBillsByDay(history).map(([day, dayBills]) => (
                <div key={day}>
                  <div className="mb-1.5 text-sm font-bold text-muted">Date: {day}</div>
                  <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
                    <table className="w-full min-w-[860px] text-[13px]">
                      <thead>
                        <tr className="bg-ground text-[10px] font-bold uppercase tracking-wider text-muted">
                          {BILL_COLUMNS.map((c, i) => (
                            <th key={c} className={`px-2.5 py-2 ${i >= 6 && i <= 8 ? "text-right" : "text-left"}`}>
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {billLineRows(dayBills, customer.name, ctx).map((r) => (
                          <tr
                            key={r.key}
                            className={`border-t border-[#f1f5f9] ${r.status === "DELETED" ? "opacity-50" : ""}`}
                          >
                            <td className="whitespace-nowrap px-2.5 py-2">{r.date}</td>
                            <td className="tabular-nums whitespace-nowrap px-2.5 py-2 text-muted">{r.time}</td>
                            <td className="max-w-[130px] truncate px-2.5 py-2">{r.customer}</td>
                            <td className="tabular-nums px-2.5 py-2 font-semibold">{r.refNo}</td>
                            <td className="px-2.5 py-2 text-muted">{r.item || "—"}</td>
                            <td className="max-w-[150px] truncate px-2.5 py-2 font-semibold">{r.subItem}</td>
                            <td className="tabular-nums px-2.5 py-2 text-right text-muted">{money(r.discount)}</td>
                            <td className="tabular-nums px-2.5 py-2 text-right">{r.qty}</td>
                            <td className="tabular-nums px-2.5 py-2 text-right font-bold">{money(r.price)}</td>
                            <td
                              className={`px-2.5 py-2 text-[11px] font-bold ${
                                r.payment === "CREDIT" ? "text-danger" : "text-success"
                              }`}
                            >
                              {r.payment}
                            </td>
                            <td className="px-2.5 py-2 text-[11px] font-bold text-muted">{r.status}</td>
                            <td className="max-w-[110px] truncate px-2.5 py-2 text-muted">{r.user || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="tabular-nums mt-1.5 text-center text-[15px] font-extrabold">
                    Total ={" "}
                    {money(dayBills.filter((b) => b.status !== "void").reduce((t, b) => t + b.total, 0))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {row.payments.length > 0 && (
            <>
              <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Payments received</h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                {row.payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between border-t border-[#f1f5f9] px-3.5 py-2.5 text-sm first:border-t-0"
                  >
                    <span className="text-muted">{dateAndTime(p.createdAt)}</span>
                    <span className="tabular-nums font-bold text-success">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
