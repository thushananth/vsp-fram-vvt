"use client";

import { useCustomerLabel } from "@/lib/customerName";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, FileDown, Printer, Search, X } from "lucide-react";
import { useCustomerBills } from "@/lib/firestore/bills";
import { describePayment, useCreditPayments } from "@/lib/firestore/credit";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useProducts } from "@/lib/firestore/products";
import { useCategories } from "@/lib/firestore/categories";
import { useUsers } from "@/lib/firestore/users";
import Stat from "@/components/ui/Stat";
import ReportTabs from "@/components/ReportTabs";
import { usePermissionGate } from "@/components/AdminGate";
import { money, dateAndTime, dateWithYear, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import BillBreakdown, {
  BILL_STATE_LABEL,
  BILL_STATE_STYLE,
  billState,
  paidSoFar,
  type BillState,
} from "@/components/BillBreakdown";
import {
  buildCustomerReport,
  downloadCustomerReportPdf,
  emptyCustomerRow,
  localDateKey,
  printCustomerReport,
  type ReportContext,
} from "@/lib/customerReport";
import type { Customer } from "@/lib/types";
import { billLabel } from "@/lib/orders";

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
  const gate = usePermissionGate("customerReports", "Customer reports", "An admin can turn on “Customer reports” for cashiers under Permissions.");
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("id");
  // Opened from the customer list, the page keeps that list's date range.
  const rangeParam = params.get("range");
  const initialRange = {
    mode: (RANGE_OPTIONS.some((o) => o.mode === rangeParam) ? rangeParam : "thisMonth") as RangeMode,
    from: params.get("from"),
    to: params.get("to"),
  };
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
        <p className="text-sm font-medium text-muted">Everything about one customer: balance, bills and payments</p>
      </div>

      {customersLoading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : customer ? (
        <CustomerStatement customer={customer} initialRange={initialRange} onChange={() => select(null)} />
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
  const { isAdmin, label } = useCustomerLabel();
  const [search, setSearch] = useState("");
  const matches = customers.filter((c) => matchesCustomerSearch(c, search, isAdmin));

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
              <div className="truncate font-semibold">{label(c.name)}</div>
              {isAdmin && (
                <div className="truncate text-[11px] font-medium text-muted-2">{c.mobileNumber || "—"}</div>
              )}
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

type BillFilter = "all" | "open" | "paid" | "deleted";

function CustomerStatement({
  customer,
  initialRange,
  onChange,
}: {
  customer: Customer;
  initialRange: { mode: RangeMode; from: string | null; to: string | null };
  onChange: () => void;
}) {
  const { isAdmin, label } = useCustomerLabel();
  const today = todayKey();
  // All of this customer's bills and payments: the account summary is all-time,
  // the bill list follows the date range.
  const { bills, loading: billsLoading } = useCustomerBills(customer.id);
  const { payments, loading: paymentsLoading } = useCreditPayments(customer.id);
  const { products } = useProducts();
  const { users } = useUsers();
  const { categories: allCategories } = useCategories();

  const [rangeMode, setRangeMode] = useState<RangeMode>(initialRange.mode);
  const [customFrom, setCustomFrom] = useState(initialRange.from ?? today);
  const [customTo, setCustomTo] = useState(initialRange.to ?? today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [openBill, setOpenBill] = useState<string | null>(null);

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
    const byId = new Map(allCategories.map((c) => [c.id, c.name]));
    return {
      categoryOf: (id, categoryId) => (categoryId && byId.get(categoryId)) || categories.get(id),
      userName: (uid) => names.get(uid),
    };
  }, [products, users, allCategories]);

  const printRange = { from: localDateKey(range.startMs), to: localDateKey(range.endMs - 1) };

  // ---- All-time account ----
  const live = bills.filter((b) => b.status !== "void");
  const lifetimeTotal = live.reduce((t, b) => t + b.total, 0);
  const openBills = live.filter((b) => b.due > 0.005);
  const firstAt = live.reduce((m, b) => (b.createdAt > 0 && b.createdAt < m ? b.createdAt : m), Infinity);
  const lastAt = live.reduce((m, b) => Math.max(m, b.createdAt), 0);
  const cashIn = payments.filter((p) => p.method !== "advance").reduce((t, p) => t + p.amount, 0);

  // ---- In range ----
  const history = [...row.bills, ...row.voidBills].sort((a, b) => b.createdAt - a.createdAt);
  const counts = { paid: 0, partial: 0, unpaid: 0, deleted: 0 } as Record<BillState, number>;
  for (const b of history) counts[billState(b)]++;
  const dueInRange = row.bills.reduce((t, b) => t + Math.max(0, b.due), 0);
  const shown = history.filter((b) => {
    const st = billState(b);
    return filter === "all"
      ? st !== "deleted"
      : filter === "open"
        ? st === "partial" || st === "unpaid"
        : filter === "paid"
          ? st === "paid"
          : st === "deleted";
  });

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

  const loading = billsLoading || paymentsLoading;

  const filters: { key: BillFilter; label: string; n: number }[] = [
    { key: "all", label: "All", n: history.length - counts.deleted },
    { key: "open", label: "Unpaid & partly paid", n: counts.unpaid + counts.partial },
    { key: "paid", label: "Paid", n: counts.paid },
    ...(counts.deleted > 0 ? [{ key: "deleted" as BillFilter, label: "Deleted", n: counts.deleted }] : []),
  ];

  return (
    <>
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center border border-border bg-ground text-lg font-extrabold text-muted ${
            customer.type === "shop" ? "rounded-full" : "rounded-xl"
          }`}
        >
          {(label(customer.name).trim()[0] ?? "?").toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[19px] font-extrabold">{label(customer.name)}</div>
          <div className="truncate text-xs font-medium text-muted-2">
            <span className="capitalize">{customer.type}</span>
            {isAdmin ? ` · ${customer.mobileNumber || "No mobile"}` : ""}
            {Number.isFinite(firstAt) && ` · customer since ${dateWithYear(firstAt)}`}
          </div>
        </div>
        <button
          onClick={onChange}
          className="min-h-[40px] shrink-0 rounded-xl border border-border px-3 text-sm font-bold text-muted"
        >
          Change
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <h2 className="mb-2 mt-5 text-[13px] font-bold uppercase tracking-wider text-muted-2">Account · all time</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Stat
              label="Owes now"
              value={money(customer.remainingCredit)}
              note={
                openBills.length > 0
                  ? `${openBills.length} bill${openBills.length === 1 ? "" : "s"} not fully paid`
                  : customer.remainingCredit > 0
                    ? "carried over from the old app"
                    : "nothing owed"
              }
              tone={customer.remainingCredit > 0 ? "warning" : "default"}
            />
            <Stat
              label="Advance held"
              value={money(customer.advance)}
              note={customer.advance > 0 ? "taken off the next bill" : "none"}
              noteColor={customer.advance > 0 ? "text-success" : "text-muted"}
            />
            <Stat label="Bought in total" value={money(lifetimeTotal)} note={`${live.length} bills`} />
            <Stat label="Paid in" value={money(cashIn)} note={`${payments.filter((p) => p.method !== "advance").length} credit payments`} />
            <Stat label="Last bill" value={lastAt > 0 ? dateWithYear(lastAt) : "—"} note={lastAt > 0 ? new Date(lastAt).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" }) : "no bills yet"} />
            {customer.openingBalance > 0 && (
              <Stat label="Old app balance" value={money(customer.openingBalance)} note="included in Owes now" />
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
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

          <div className="mt-3 flex items-end justify-between gap-2">
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-2">{range.label}</h2>
            <div className="flex gap-2">
              <button
                onClick={handlePrint}
                className="min-h-[44px] rounded-xl border border-border bg-surface px-3.5 text-sm font-bold text-muted"
              >
                <Printer className="mr-1.5 inline h-3.5 w-3.5" />
                Print
              </button>
              <button
                onClick={() => void handlePdf()}
                disabled={saving}
                className="min-h-[44px] rounded-xl bg-accent px-3.5 text-sm font-bold text-white disabled:opacity-50"
              >
                <FileDown className="mr-1.5 inline h-3.5 w-3.5" />
                {saving ? "Creating…" : "PDF"}
              </button>
            </div>
          </div>

          {message && (
            <p className="mt-2.5 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm font-semibold text-danger">
              {message}
            </p>
          )}

          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Purchases" value={money(row.total)} note={`${row.bills.length} bills`} />
            <Stat label="Cash bills" value={money(row.cash)} note="paid at the till" />
            <Stat label="Credit bills" value={money(row.credit)} note="on account" />
            <Stat label="Received" value={money(row.received)} note={`${row.payments.length} payments`} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 text-xs font-bold">
            <span className={`rounded-lg px-2.5 py-1.5 ${BILL_STATE_STYLE.paid}`}>{counts.paid} paid</span>
            <span className={`rounded-lg px-2.5 py-1.5 ${BILL_STATE_STYLE.partial}`}>{counts.partial} partly paid</span>
            <span className={`rounded-lg px-2.5 py-1.5 ${BILL_STATE_STYLE.unpaid}`}>{counts.unpaid} unpaid</span>
            {dueInRange > 0 && (
              <span className="tabular-nums rounded-lg bg-warning/10 px-2.5 py-1.5 text-warning">
                {money(dueInRange)} still due on these bills
              </span>
            )}
          </div>

          <h2 className="mb-2 mt-6 text-[17px] font-bold">Bills</h2>
          <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold ${
                  filter === f.key ? "bg-ink text-white" : "border border-border bg-surface text-muted"
                }`}
              >
                {f.label} · {f.n}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
              No bills here for {label(customer.name)} in {range.label.toLowerCase()}.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((b) => {
                const st = billState(b);
                const open = openBill === b.id;
                const paid = paidSoFar(b);
                return (
                  <div key={b.id} className={`rounded-2xl border border-border bg-surface ${st === "deleted" ? "opacity-60" : ""}`}>
                    <button
                      onClick={() => setOpenBill(open ? null : b.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-[15px] font-extrabold">{billLabel(b)}</span>
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${BILL_STATE_STYLE[st]}`}>
                            {BILL_STATE_LABEL[st]}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-2">
                            {b.paymentType === "credit" ? "Credit" : "Cash"}
                          </span>
                        </div>
                        <div className="tabular-nums text-[11px] font-medium text-muted-2">{dateAndTime(b.createdAt)}</div>
                        <div className="truncate text-xs font-medium text-muted">
                          {b.lines.map((l) => `${l.name} × ${l.qty}`).join(", ")}
                        </div>
                      </div>
                      <div className="tabular-nums shrink-0 text-right">
                        <div className="text-base font-extrabold">{money(b.total)}</div>
                        {st === "partial" && (
                          <div className="text-[11px] font-bold">
                            <span className="text-success">paid {money(paid)}</span>
                            <span className="text-warning"> · due {money(b.due)}</span>
                          </div>
                        )}
                        {st === "unpaid" && <div className="text-[11px] font-bold text-danger">due {money(b.due)}</div>}
                      </div>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-2 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && <BillBreakdown bill={b} payments={payments} />}
                  </div>
                );
              })}
            </div>
          )}

          {row.payments.length > 0 && (
            <>
              <h2 className="mb-2.5 mt-6 text-[17px] font-bold">Payments received</h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-surface">
                {row.payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 border-t border-[#f1f5f9] px-3.5 py-2.5 text-sm first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="text-muted">{dateAndTime(p.createdAt)}</div>
                      <div className="truncate text-[11px] font-medium text-muted-2">
                        {describePayment(p) || "Payment"}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </div>
                    <span className="tabular-nums shrink-0 font-bold text-success">{money(p.amount)}</span>
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
