"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileDown, FileText, Lock } from "lucide-react";
import { useBills } from "@/lib/firestore/bills";
import { useCreditPayments } from "@/lib/firestore/credit";
import { useCustomers } from "@/lib/firestore/customers";
import { useProducts } from "@/lib/firestore/products";
import { useCategories } from "@/lib/firestore/categories";
import { useUsers } from "@/lib/firestore/users";
import { useCan } from "@/lib/firestore/permissions";
import Splash from "@/components/Splash";
import ReportTabs from "@/components/ReportTabs";
import { dateAndTime, localDateKey, money, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import { buildSalesReport } from "@/lib/salesReport";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

function Kpi({ label, value, note, dark }: { label: string; value: string; note?: string; dark?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${dark ? "bg-ink text-white" : "border border-border bg-surface"}`}>
      <div className={`text-[11px] font-bold uppercase tracking-wider ${dark ? "text-amber-200" : "text-muted-2"}`}>
        {label}
      </div>
      <div className="tabular-nums mt-1 text-[22px] font-extrabold leading-tight">{value}</div>
      {note && <div className={`mt-0.5 text-xs font-semibold ${dark ? "text-white/60" : "text-muted"}`}>{note}</div>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        {note && <span className="text-xs font-semibold text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export default function ReportPage() {
  const { can, loading: canLoading } = useCan();
  const today = todayKey();
  const { bills, loading: billsLoading } = useBills();
  const { payments, loading: paymentsLoading } = useCreditPayments();
  const { customers } = useCustomers();
  const { products } = useProducts({ includeInactive: true });
  const { categories } = useCategories();
  const { users } = useUsers();

  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [busy, setBusy] = useState<"summary" | "detail" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // The old app's five report permissions: today vs any date, summary vs detail.
  const canAnyDate = can("rangeSummary") || can("rangeDetail");
  const mode = canAnyDate ? rangeMode : "today";
  const range = useMemo(
    () => resolveRange(mode, { from: customFrom, to: customTo }),
    [mode, customFrom, customTo],
  );
  const isToday = range.singleDayKey === today;
  const canSummary = isToday ? can("todaySummary") || can("rangeSummary") : can("rangeSummary");
  const canDetail = isToday ? can("todayDetail") || can("rangeDetail") : can("rangeDetail");

  const report = useMemo(
    () =>
      buildSalesReport({
        bills,
        payments,
        customers,
        products,
        categories,
        startMs: range.startMs,
        endMs: range.endMs,
      }),
    [bills, payments, customers, products, categories, range],
  );
  const t = report.totals;

  const chart = useMemo(() => {
    if (range.singleDayKey) {
      const buckets = Array.from({ length: 16 }, (_, i) => ({ key: String(i + 6), label: `${i + 6}`, total: 0 }));
      for (const b of report.bills) {
        const bucket = buckets.find((x) => x.key === String(new Date(b.createdAt).getHours()));
        if (bucket) bucket.total += b.total;
      }
      return buckets;
    }
    return report.byDay.map((d) => ({ key: d.day, label: String(Number(d.day.slice(8, 10))), total: d.total }));
  }, [report, range.singleDayKey]);
  const chartMax = Math.max(1, ...chart.map((c) => c.total));
  const categoryMax = Math.max(1, ...report.byCategory.map((c) => c.total));
  const outstandingTotal = report.outstanding.reduce((s, o) => s + o.balance, 0);

  async function pdf(kind: "summary" | "detail") {
    setBusy(kind);
    setPdfError(null);
    try {
      const { downloadDetailPdf, downloadSummaryPdf } = await import("@/lib/pdf/salesReportPdf");
      const label = range.singleDayKey ?? `${localDateKey(range.startMs)} to ${localDateKey(range.endMs - 1)}`;
      if (kind === "summary") await downloadSummaryPdf(report, label);
      else
        await downloadDetailPdf(report, label, {
          userName: (uid) => users.find((u) => u.uid === uid)?.name ?? "",
          unitOf: (id) => products.find((p) => p.id === id)?.unit ?? "",
        });
    } catch (err) {
      setPdfError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (canLoading) return <Splash />;
  if (!can("todaySummary") && !can("todayDetail") && !canAnyDate) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <ReportTabs />
        <h1 className="text-xl font-extrabold">Reports are admin-only</h1>
        <p className="mt-1.5 text-sm font-medium text-muted">An admin can open them up for cashiers under Permissions.</p>
      </div>
    );
  }

  const loading = billsLoading || paymentsLoading;

  return (
    <div className="mx-auto max-w-5xl p-4 pb-10">
      <ReportTabs />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Sales report</h1>
          <p className="text-sm font-medium text-muted">{range.label}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => pdf("summary")}
            disabled={!canSummary || busy !== null || loading}
            className="flex min-h-[42px] items-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-bold text-white disabled:opacity-40"
          >
            <FileDown size={16} /> {busy === "summary" ? "Preparing…" : "Summary PDF"}
          </button>
          <button
            onClick={() => pdf("detail")}
            disabled={!canDetail || busy !== null || loading}
            className="flex min-h-[42px] items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[13px] font-bold disabled:opacity-40"
          >
            <FileText size={16} /> {busy === "detail" ? "Preparing…" : "Detail PDF"}
          </button>
        </div>
      </div>
      {pdfError && <p className="mt-2 text-sm font-bold text-danger">Couldn&apos;t make the PDF — {pdfError}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {RANGE_OPTIONS.map((o) => {
          const locked = !canAnyDate && o.mode !== "today";
          return (
            <button
              key={o.mode}
              onClick={() => !locked && setRangeMode(o.mode)}
              disabled={locked}
              title={locked ? "An admin can allow other dates under Permissions" : undefined}
              className={`flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg px-2 text-[13px] font-bold ${
                mode === o.mode ? "bg-white shadow-sm" : "text-muted"
              } disabled:opacity-50`}
            >
              {locked && <Lock size={11} />}
              {o.label}
            </button>
          );
        })}
      </div>
      {mode === "custom" && (
        <div className="mt-2.5 flex items-center gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium" />
          <span className="text-sm font-semibold text-muted">to</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-11 flex-1 rounded-xl border border-border bg-surface px-3 text-sm font-medium" />
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-muted">Loading…</p>
      ) : !canSummary ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <p className="font-extrabold">Summary isn&apos;t enabled for this range</p>
          <p className="mt-1 text-sm text-muted">
            {canDetail ? "The detail PDF is available above." : "An admin can allow it under Permissions."}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Kpi dark label="Net sales" value={money(t.net)} note={`${t.bills} bills`} />
            <Kpi label="Cash sales" value={money(t.cash)} note={`Cash taken in ${money(t.cashIn)}`} />
            <Kpi label="Credit sales" value={money(t.credit)} note="Bills put on account" />
            <Kpi label="From debtors" value={money(t.received)} note={`${report.payments.length} payments`} />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-border">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Round-off</div>
              <div className="tabular-nums text-base font-extrabold">{money(t.roundOff)}</div>
            </div>
            <div className="rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-border">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Price discounts</div>
              <div className="tabular-nums text-base font-extrabold">{money(t.priceDiscount)}</div>
            </div>
            <div className="rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-border">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Deleted · {t.voidBills}</div>
              <div className="tabular-nums text-base font-extrabold text-danger">{money(t.voided)}</div>
            </div>
          </div>

          <Panel title={range.singleDayKey ? "Sales by hour" : "Sales by day"}>
            <div className="overflow-x-auto p-4 pb-3">
              {t.net === 0 ? (
                <p className="py-8 text-center text-sm text-muted">No sales in this range.</p>
              ) : (
                <div className="flex h-[150px] min-w-full items-end gap-1.5">
                  {chart.map((h) => (
                    <div key={h.key} className="group flex h-full min-w-[14px] flex-1 flex-col items-center justify-end gap-1.5">
                      <div
                        title={money(h.total)}
                        className="w-full rounded-t-md bg-[#D97706] transition-opacity group-hover:opacity-80"
                        style={{ height: `${Math.max(h.total ? 4 : 1, (h.total / chartMax) * 100)}%` }}
                      />
                      <div className="tabular-nums text-[10px] font-semibold text-muted-2">{h.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By category" note="cash · credit">
              <div className="flex flex-col gap-3 p-4">
                {report.byCategory.length === 0 && <p className="text-sm text-muted">No sales.</p>}
                {report.byCategory.map((c) => (
                  <div key={c.id || c.name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-bold">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                      <span className="tabular-nums font-extrabold">{money(c.total)}</span>
                    </div>
                    <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-ground">
                      <div style={{ width: `${(c.cash / categoryMax) * 100}%`, backgroundColor: c.color }} />
                      <div style={{ width: `${(c.credit / categoryMax) * 100}%`, backgroundColor: c.color, opacity: 0.4 }} />
                    </div>
                    <div className="tabular-nums mt-1 text-[11px] font-semibold text-muted">
                      Cash {money(c.cash)} · Credit {money(c.credit)}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Received from debtors" note={money(t.received)}>
              <div className="max-h-[320px] overflow-y-auto">
                {report.payments.length === 0 ? (
                  <p className="p-4 text-sm text-muted">No credit payments in this range.</p>
                ) : (
                  report.payments
                    .slice()
                    .reverse()
                    .map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 border-b border-[#f1f5f9] px-4 py-2.5 last:border-0">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{p.customerName}</div>
                          <div className="text-[11px] font-medium text-muted">{dateAndTime(p.createdAt)}</div>
                        </div>
                        <span className="tabular-nums text-sm font-extrabold text-success">{money(p.amount)}</span>
                      </div>
                    ))
                )}
              </div>
            </Panel>
          </div>

          <Panel title="By product" note={`${report.byProduct.length} products`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="bg-ground text-[10px] font-bold uppercase tracking-wider text-muted">
                    <th className="px-4 py-2.5 text-left">Product</th>
                    <th className="px-3 py-2.5 text-right">Cash qty</th>
                    <th className="px-3 py-2.5 text-right">Cash</th>
                    <th className="px-3 py-2.5 text-right">Credit qty</th>
                    <th className="px-3 py-2.5 text-right">Credit</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byProduct.map((r) => (
                    <tr key={r.key} className="border-t border-[#f1f5f9]">
                      <td className="px-4 py-2.5">
                        <div className="font-bold">{r.name}</div>
                        <div className="text-[11px] font-medium text-muted-2">{r.category}</div>
                      </td>
                      <td className="tabular-nums px-3 py-2.5 text-right text-muted">{r.cashQty ? `${r.cashQty} ${r.unit}` : "—"}</td>
                      <td className="tabular-nums px-3 py-2.5 text-right">{money(r.cash)}</td>
                      <td className="tabular-nums px-3 py-2.5 text-right text-muted">{r.creditQty ? `${r.creditQty} ${r.unit}` : "—"}</td>
                      <td className="tabular-nums px-3 py-2.5 text-right">{money(r.credit)}</td>
                      <td className="tabular-nums px-4 py-2.5 text-right font-extrabold">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.byProduct.length === 0 && <p className="p-6 text-center text-sm text-muted">No sales in this range.</p>}
            </div>
          </Panel>

          {report.byDay.length > 1 && (
            <Panel title="By date">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-ground text-[10px] font-bold uppercase tracking-wider text-muted">
                      <th className="px-4 py-2.5 text-left">Date</th>
                      <th className="px-3 py-2.5 text-right">Bills</th>
                      <th className="px-3 py-2.5 text-right">Cash</th>
                      <th className="px-3 py-2.5 text-right">Credit</th>
                      <th className="px-3 py-2.5 text-right">Received</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDay.map((d) => (
                      <tr key={d.day} className="border-t border-[#f1f5f9]">
                        <td className="px-4 py-2.5 font-bold">{d.day}</td>
                        <td className="tabular-nums px-3 py-2.5 text-right text-muted">{d.bills}</td>
                        <td className="tabular-nums px-3 py-2.5 text-right">{money(d.cash)}</td>
                        <td className="tabular-nums px-3 py-2.5 text-right">{money(d.credit)}</td>
                        <td className="tabular-nums px-3 py-2.5 text-right text-success">{money(d.received)}</td>
                        <td className="tabular-nums px-4 py-2.5 text-right font-extrabold">{money(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel title="Credit outstanding" note={`${report.outstanding.length} customers · ${money(outstandingTotal)}`}>
            <div className="max-h-[360px] overflow-y-auto">
              {report.outstanding.length === 0 ? (
                <p className="p-4 text-sm text-muted">Nobody owes anything.</p>
              ) : (
                report.outstanding.map((o) => (
                  <div key={o.customerId} className="flex items-center gap-3 border-b border-[#f1f5f9] px-4 py-2.5 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{o.name}</div>
                      <div className="text-[11px] font-medium text-muted">
                        {o.lastPaymentAt
                          ? `Last paid ${money(o.lastPaymentAmount ?? 0)} on ${localDateKey(o.lastPaymentAt)}`
                          : "No payments recorded here yet"}
                      </div>
                    </div>
                    <div className="flex w-28 shrink-0 flex-col items-end gap-1">
                      <span className="tabular-nums text-sm font-extrabold text-warning">{money(o.balance)}</span>
                      <span className="h-1 w-full overflow-hidden rounded-full bg-ground">
                        <span
                          className="block h-full rounded-full bg-warning"
                          style={{ width: `${(o.balance / (report.outstanding[0]?.balance || 1)) * 100}%` }}
                        />
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <p className="text-center text-xs font-medium text-muted-2">
            Bill-by-bill? Use the Detail PDF, or open <Link href="/bills" className="font-bold underline">Bills</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
