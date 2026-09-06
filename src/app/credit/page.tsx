"use client";

import { useMemo, useState } from "react";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useCustomerBills } from "@/lib/firestore/bills";
import { allocate, outstandingLines, payCredit, useCreditPayments } from "@/lib/firestore/credit";
import { useAuth } from "@/lib/auth";
import { dateAndTime, money } from "@/lib/format";
import type { Customer } from "@/lib/types";

type Tab = "Collect" | "History";

export default function CreditPage() {
  const [tab, setTab] = useState<Tab>("Collect");
  const [selected, setSelected] = useState<Customer | null>(null);

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Credit</h1>
        <p className="text-sm font-medium text-muted">Take payments against what customers owe</p>
      </div>

      <div className="mt-3 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {(["Collect", "History"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-h-[44px] flex-1 rounded-lg text-sm font-bold ${
              tab === t ? "bg-white shadow-sm" : "text-muted"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Collect" ? <CollectTab selected={selected} onSelect={setSelected} /> : <HistoryTab />}
    </div>
  );
}

function CollectTab({
  selected,
  onSelect,
}: {
  selected: Customer | null;
  onSelect: (c: Customer | null) => void;
}) {
  const { customers, loading } = useCustomers();
  const [search, setSearch] = useState("");

  // Live doc, so the balance updates under the sheet as payments land.
  const current = selected ? (customers.find((c) => c.id === selected.id) ?? selected) : null;

  const owing = useMemo(
    () =>
      customers
        .filter((c) => c.remainingCredit > 0 && matchesCustomerSearch(c, search))
        .sort((a, b) => b.remainingCredit - a.remainingCredit),
    [customers, search],
  );

  const totalOwed = owing.reduce((sum, c) => sum + c.remainingCredit, 0);

  return (
    <>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-warning">
            Total outstanding
          </div>
          <div className="text-xs font-medium text-muted-2">{owing.length} customers owing</div>
        </div>
        <span className="tabular-nums text-2xl font-extrabold text-warning">{money(totalOwed)}</span>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or mobile"
        className="mt-3 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-accent"
      />

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {owing.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold">{c.name}</div>
                <div className="text-xs font-medium text-muted-2">
                  {c.mobileNumber || "No mobile"}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums text-lg font-extrabold text-warning">
                  {money(c.remainingCredit)}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-2">owed</div>
              </div>
            </button>
          ))}
          {owing.length === 0 && (
            <p className="py-8 text-center text-muted">
              {search ? "No customer matches that." : "All clear — nobody owes anything."}
            </p>
          )}
        </div>
      )}

      {current && <PaymentSheet customer={current} onClose={() => onSelect(null)} />}
    </>
  );
}

function PaymentSheet({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { bills, loading } = useCustomerBills(customer.id);
  const { profile, user } = useAuth();
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lines = useMemo(
    () => outstandingLines({ bills, openingBalance: customer.openingBalance }),
    [bills, customer.openingBalance],
  );
  const owed = lines.reduce((sum, l) => sum + l.due, 0);

  const amount = Number(amountText) || 0;
  const preview = amount > 0 ? allocate(Math.min(amount, owed), lines) : [];
  const tooMuch = amount > owed + 0.001;

  async function handlePay() {
    const receivedBy = profile?.uid ?? user?.uid;
    if (!receivedBy) return;
    setError(null);
    setSaving(true);
    try {
      const result = await payCredit({
        customerId: customer.id,
        amount,
        receivedBy,
        note: note.trim() || null,
      });
      const applied = result.allocations.reduce((sum, a) => sum + a.amount, 0);
      setDone(`${money(applied)} received from ${customer.name}`);
      setAmountText("");
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{customer.name}</div>
            <div className="text-sm font-medium text-muted">
              {customer.mobileNumber || "No mobile"}
            </div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-xl bg-warning/5 px-3.5 py-3">
          <span className="text-sm font-semibold text-warning">Outstanding</span>
          <span className="tabular-nums text-xl font-extrabold text-warning">{money(owed)}</span>
        </div>

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Oldest first
        </div>
        {loading ? (
          <p className="py-4 text-center text-muted">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">Nothing outstanding.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {lines.map((l) => {
              const share = preview.find((a) => a.billId === l.billId)?.amount ?? 0;
              return (
                <div
                  key={l.billId ?? "opening"}
                  className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 ${
                    share > 0 ? "border-success/40 bg-success/5" : "border-border"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{l.label}</div>
                    {l.createdAt > 0 && (
                      <div className="text-[11px] font-medium text-muted-2">
                        {dateAndTime(l.createdAt)}
                      </div>
                    )}
                  </div>
                  <div className="tabular-nums text-right">
                    <div className="text-sm font-bold">{money(l.due)}</div>
                    {share > 0 && (
                      <div className="text-[11px] font-bold text-success">
                        −{money(share)}
                        {share >= l.due ? " · clears" : ""}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Amount received
        </div>
        <div className="flex items-center gap-2.5">
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            className="tabular-nums h-[54px] flex-1 rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-2xl font-extrabold text-ink"
          />
          <button
            onClick={() => setAmountText(String(owed))}
            className="min-h-[54px] shrink-0 rounded-2xl border border-border px-3.5 text-sm font-bold text-muted"
          >
            Settle all
          </button>
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="mt-2 h-[46px] w-full rounded-xl border border-border bg-ground px-3.5 text-base outline-none focus:border-accent"
        />

        {tooMuch && (
          <p className="mt-2 text-sm font-semibold text-danger">
            More than the {money(owed)} outstanding — we don&apos;t hold advances.
          </p>
        )}
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
        {done && <p className="mt-2 text-sm font-semibold text-success">{done}</p>}

        <button
          onClick={handlePay}
          disabled={saving || amount <= 0 || tooMuch || owed <= 0}
          className="mt-4 min-h-[54px] w-full rounded-2xl bg-success text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Taking payment…" : `Take ${amount > 0 ? money(amount) : "payment"}`}
        </button>
      </div>
    </div>
  );
}

function HistoryTab() {
  const { payments, loading } = useCreditPayments();

  const todayStart = new Date().setHours(0, 0, 0, 0);
  const today = payments.filter((p) => p.createdAt >= todayStart);
  const todayTotal = today.reduce((sum, p) => sum + p.amount, 0);

  return (
    <>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-success/30 bg-success/5 px-3.5 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-success">
            Collected today
          </div>
          <div className="text-xs font-medium text-muted-2">{today.length} payments</div>
        </div>
        <span className="tabular-nums text-2xl font-extrabold text-success">
          {money(todayTotal)}
        </span>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {payments.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold">{p.customerName}</div>
                <div className="text-xs font-medium text-muted-2">
                  {dateAndTime(p.createdAt)} ·{" "}
                  {p.allocations.map((a) => (a.billNo ? `#${a.billNo}` : "Opening")).join(", ")}
                </div>
                {p.note && <div className="text-xs font-medium text-muted-2">{p.note}</div>}
              </div>
              <span className="tabular-nums text-lg font-extrabold text-success">
                {money(p.amount)}
              </span>
            </div>
          ))}
          {payments.length === 0 && (
            <p className="py-8 text-center text-muted">No credit payments yet.</p>
          )}
        </div>
      )}
    </>
  );
}
