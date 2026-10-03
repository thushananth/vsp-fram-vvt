"use client";

import { useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import { useCustomerBills } from "@/lib/firestore/bills";
import {
  allocate,
  describePayment,
  deleteCreditPayment,
  editCreditPayment,
  isCashPayment,
  outstandingLines,
  payCredit,
  useCreditPayments,
} from "@/lib/firestore/credit";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/lib/firestore/permissions";
import { useStoreSettings } from "@/lib/firestore/settings";
import { printTickets } from "@/lib/printer";
import { paymentReceipt } from "@/lib/receipts";
import NumField from "@/components/ui/NumField";
import { dateAndTime, money, todayKey } from "@/lib/format";
import { resolveRange, type RangeMode } from "@/lib/dateRanges";
import type { Customer, CreditPayment } from "@/lib/types";

type Tab = "Collect" | "History";

const RANGE_OPTIONS: { mode: RangeMode; label: string }[] = [
  { mode: "today", label: "Today" },
  { mode: "yesterday", label: "Yesterday" },
  { mode: "thisMonth", label: "This month" },
  { mode: "lastMonth", label: "Last month" },
  { mode: "custom", label: "Custom" },
];

export default function CreditPage() {
  const [tab, setTab] = useState<Tab>("Collect");
  const [selected, setSelected] = useState<Customer | null>(null);
  const { can } = useCan();
  const tabs: Tab[] = can("viewPaymentHistory") ? ["Collect", "History"] : ["Collect"];

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Credit</h1>
        <p className="text-sm font-medium text-muted">Take payments against what customers owe</p>
      </div>

      <div className="mt-3 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
        {tabs.map((t) => (
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

      {tab === "Collect" || !tabs.includes(tab) ? <CollectTab selected={selected} onSelect={setSelected} /> : <HistoryTab />}
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
        // Searching shows everyone, so an advance can be taken from a customer
        // who owes nothing yet.
        .filter(
          (c) => (c.remainingCredit > 0 || c.advance > 0 || !!search.trim()) && matchesCustomerSearch(c, search),
        )
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
          <div className="text-xs font-medium text-muted-2">
            {owing.filter((c) => c.remainingCredit > 0).length} customers owing
          </div>
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
                {c.advance > 0 && (
                  <div className="tabular-nums text-[11px] font-bold text-success">+{money(c.advance)} advance</div>
                )}
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
  const { settings } = useStoreSettings();
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lines = useMemo(
    () => outstandingLines({ bills, openingBalance: customer.openingBalance }),
    [bills, customer.openingBalance],
  );
  const owed = Math.round(lines.reduce((sum, l) => sum + l.due, 0) * 100) / 100;

  const amount = Number(amountText) || 0;
  const preview = amount > 0 ? allocate(Math.min(amount, owed), lines) : [];
  // Paying more than is owed is fine — the rest is held for the customer.
  const extra = Math.max(0, Math.round((amount - owed) * 100) / 100);
  const usable = Math.min(customer.advance, owed);

  async function handleUseAdvance() {
    const receivedBy = profile?.uid ?? user?.uid;
    if (!receivedBy || usable <= 0) return;
    setError(null);
    setDone(null);
    setSaving(true);
    try {
      const result = await payCredit({
        customerId: customer.id,
        amount: usable,
        receivedBy,
        note: null,
        source: "advance",
      });
      const applied = result.allocations.reduce((sum, a) => sum + a.amount, 0);
      setDone(`${money(applied)} of ${customer.name}'s advance used against what they owe`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
      setDone(
        result.advance > 0
          ? `${money(amount)} received from ${customer.name} — ${money(result.advance)} kept as advance`
          : `${money(amount)} received from ${customer.name}`,
      );
      // The old app handed the customer a payment slip every time.
      if (settings.printBills) {
        printTickets([
          paymentReceipt({
            paperWidth: settings.paperWidth,
            customerName: customer.name,
            amount,
            balanceBefore: owed,
            advance: result.advance,
            advanceHeld: customer.advance + result.advance,
          }),
        ])
          .then((r) => {
            if (!r.success) setDone(`${money(amount)} received — receipt not printed (${r.error})`);
          })
          .catch(() => {});
      }
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
        {customer.advance > 0 && (
          <div className="mt-2 flex items-center gap-3 rounded-xl bg-success/5 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-success">Advance held</div>
              <div className="tabular-nums text-xl font-extrabold text-success">{money(customer.advance)}</div>
            </div>
            {usable > 0 && (
              <button
                onClick={() => void handleUseAdvance()}
                disabled={saving}
                className="min-h-[44px] shrink-0 rounded-xl bg-success px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                Use {money(usable)}
              </button>
            )}
          </div>
        )}

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
          <NumField
            value={amountText}
            onValue={setAmountText}
            placeholder="0"
            aria-label="Amount received"
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

        {extra > 0 && (
          <p className="tabular-nums mt-2 rounded-xl bg-success/5 px-3.5 py-2.5 text-sm font-semibold text-success">
            {owed > 0 ? `Clears the ${money(owed)} owed — ` : "Nothing is owed — "}
            {money(extra)} is kept as advance for {customer.name}.
          </p>
        )}
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
        {done && <p className="mt-2 text-sm font-semibold text-success">{done}</p>}

        <button
          onClick={handlePay}
          disabled={saving || loading || amount <= 0}
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
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [editing, setEditing] = useState<CreditPayment | null>(null);
  const [deleting, setDeleting] = useState<CreditPayment | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const today = todayKey();
  const [rangeMode, setRangeMode] = useState<RangeMode>("today");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const range = useMemo(
    () => resolveRange(rangeMode, { from: customFrom, to: customTo }),
    [rangeMode, customFrom, customTo],
  );
  const inRange = useMemo(
    () => payments.filter((p) => p.createdAt >= range.startMs && p.createdAt < range.endMs),
    [payments, range],
  );
  // Spending held advance is not money coming in.
  const rangeTotal = inRange.filter(isCashPayment).reduce((sum, p) => sum + p.amount, 0);

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteCreditPayment(deleting.id);
      setDeleting(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.mode}
            onClick={() => setRangeMode(o.mode)}
            className={`min-h-[40px] rounded-xl px-3.5 text-[13px] font-bold ${
              rangeMode === o.mode ? "bg-accent text-white" : "border border-border bg-surface text-muted"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {rangeMode === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            aria-label="From date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
          <span className="text-sm font-bold text-muted-2">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={today}
            onChange={(e) => setCustomTo(e.target.value)}
            aria-label="To date"
            className="min-h-[44px] flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm font-bold outline-none focus:border-accent"
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between rounded-xl border border-success/30 bg-success/5 px-3.5 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-success">
            Collected · {range.label}
          </div>
          <div className="text-xs font-medium text-muted-2">{inRange.filter(isCashPayment).length} payments</div>
        </div>
        <span className="tabular-nums text-2xl font-extrabold text-success">
          {money(rangeTotal)}
        </span>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {inRange.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold">{p.customerName}</div>
                <div className="text-xs font-medium text-muted-2">
                  {dateAndTime(p.createdAt)} · {describePayment(p)}
                </div>
                {p.note && <div className="text-xs font-medium text-muted-2">{p.note}</div>}
              </div>
              <span
                className={`tabular-nums text-lg font-extrabold ${isCashPayment(p) ? "text-success" : "text-muted"}`}
              >
                {money(p.amount)}
              </span>
              {isAdmin && (
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => setEditing(p)}
                    disabled={!isCashPayment(p) || p.imported}
                    aria-label="Edit payment"
                    className="rounded-lg border border-border bg-surface p-2 text-muted disabled:opacity-30"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => { setDeleting(p); setDeleteError(null); }}
                    aria-label="Delete payment"
                    className="rounded-lg border border-danger/30 bg-danger/10 p-2 text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {inRange.length === 0 && (
            <p className="py-8 text-center text-muted">No credit payments in this range.</p>
          )}
        </div>
      )}

      {editing && <EditPaymentSheet payment={editing} onClose={() => setEditing(null)} />}

      {deleting && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/50 sm:items-center">
          <div className="mx-auto w-full max-w-sm rounded-t-3xl bg-surface p-5 sm:rounded-3xl">
            <h3 className="text-lg font-extrabold">Delete this payment?</h3>
            <p className="mt-1.5 text-sm font-medium text-muted">
              {money(deleting.amount)} from {deleting.customerName} on {dateAndTime(deleting.createdAt)}.
              The amount goes back onto their balance. This cannot be undone.
            </p>
            {deleteError && (
              <p role="alert" className="mt-3 text-xs font-bold text-danger">
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setDeleting(null); setDeleteError(null); }}
                disabled={deleteBusy}
                className="min-h-[48px] flex-1 rounded-xl border border-border text-sm font-bold text-muted disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleteBusy}
                className="min-h-[48px] flex-1 rounded-xl bg-danger text-sm font-bold text-white disabled:opacity-40"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Change a payment's amount and/or note — reallocates it fresh, oldest outstanding first. */
function EditPaymentSheet({ payment, onClose }: { payment: CreditPayment; onClose: () => void }) {
  const [amountText, setAmountText] = useState(String(payment.amount));
  const [note, setNote] = useState(payment.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(amountText) || 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await editCreditPayment(payment.id, { amount, note: note.trim() || null });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-ink/50">
      <div className="mx-auto w-full max-w-lg rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{payment.customerName}</div>
            <div className="text-sm font-medium text-muted">{dateAndTime(payment.createdAt)}</div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <p className="mt-3 text-xs font-medium leading-relaxed text-muted-2">
          Changing the amount reverses this payment and reallocates the new amount across whatever
          is outstanding now, oldest first — it may land on different bills than the original did.
        </p>

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Amount received
        </div>
        <input
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          className="tabular-nums h-[54px] w-full rounded-2xl border-[1.5px] border-[#dbe3ee] bg-ground px-3.5 text-2xl font-extrabold text-ink"
        />

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="mt-2 h-[46px] w-full rounded-xl border border-border bg-ground px-3.5 text-base outline-none focus:border-accent"
        />

        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}

        <button
          onClick={() => void handleSave()}
          disabled={saving || amount <= 0}
          className="mt-4 min-h-[54px] w-full rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
