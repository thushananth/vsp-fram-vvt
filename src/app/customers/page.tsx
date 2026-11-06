"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import CustomerSheet from "@/components/CustomerSheet";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useCustomerBills } from "@/lib/firestore/bills";
import { useCreditPayments, describePayment } from "@/lib/firestore/credit";
import { useAuth } from "@/lib/auth";
import { useCustomerLabel } from "@/lib/customerName";
import { useCan } from "@/lib/firestore/permissions";
import { dateAndTime, money } from "@/lib/format";
import { normalizeMobile, reminderPreview, sendReminderSms } from "@/lib/sms";
import { MessageSquare } from "lucide-react";
import type { Customer, CustomerType } from "@/lib/types";
import { billLabel } from "@/lib/orders";

export default function CustomersPage() {
  const { customers, loading } = useCustomers();
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [reminding, setReminding] = useState<Customer | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const isAdmin = profile?.role === "admin";
  const { label } = useCustomerLabel();
  const { can } = useCan();
  const router = useRouter();

  /** The customer's full page (balance, every bill, payments) when this user may see
   *  customer reports; otherwise the short history sheet. */
  function openCustomer(c: Customer) {
    if (can("customerReports")) router.push(`/report/customer?id=${encodeURIComponent(c.id)}`);
    else setViewing(c);
  }

  const rows = useMemo(
    () => customers.filter((c) => matchesCustomerSearch(c, search, isAdmin)),
    [customers, search, isAdmin],
  );

  const owing = customers.filter((c) => c.remainingCredit > 0);
  const totalOwed = owing.reduce((sum, c) => sum + c.remainingCredit, 0);

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Customers</h1>
          <p className="text-sm font-medium text-muted">Shops and people who buy on credit</p>
        </div>
        {can("addCustomers") && (
          <button
            onClick={() => setCreating(true)}
            className="min-h-[46px] shrink-0 rounded-xl bg-accent px-4 text-sm font-bold text-white"
          >
            + New customer
          </button>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <div className="flex-1 rounded-xl border border-border bg-surface px-3.5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Customers</div>
          <div className="tabular-nums text-xl font-extrabold">{customers.length}</div>
        </div>
        <div className="flex-1 rounded-xl border border-border bg-surface px-3.5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-2">Owing</div>
          <div className="tabular-nums text-xl font-extrabold">{owing.length}</div>
        </div>
        <div className="flex-1 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-warning">Outstanding</div>
          <div className="tabular-nums text-xl font-extrabold text-warning">{money(totalOwed)}</div>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={isAdmin ? "Search by name or mobile" : "Search by name"}
        className="mt-3 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-accent"
      />

      {loading ? (
        <SkeletonRows label="Loading customers" />
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex min-h-[72px] items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-3"
            >
              <button onClick={() => openCustomer(c)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-bold">{label(c.name)}</span>
                  <span className="shrink-0 rounded-md bg-ground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    {c.type}
                  </span>
                </div>
                {isAdmin && (
                  <div className="text-xs font-medium text-muted-2">
                    {c.mobileNumber || "No mobile"}
                  </div>
                )}
              </button>
              <div className="shrink-0 text-right">
                <div
                  className={`tabular-nums text-lg font-extrabold ${
                    c.remainingCredit > 0 ? "text-warning" : "text-muted-2"
                  }`}
                >
                  {money(c.remainingCredit)}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-2">owed</div>
                {c.advance > 0 && (
                  <div className="tabular-nums text-[11px] font-bold text-success">+{money(c.advance)} advance</div>
                )}
              </div>
              {c.remainingCredit > 0 && normalizeMobile(c.mobileNumber) && (
                <button
                  onClick={() => setReminding(c)}
                  aria-label={`Send ${label(c.name)} a balance reminder`}
                  title={c.lastReminderAt ? `Last reminded ${dateAndTime(c.lastReminderAt)}` : "Send a balance reminder SMS"}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-2 text-[11px] font-bold text-accent"
                >
                  <MessageSquare size={13} strokeWidth={2.4} />
                  Remind
                </button>
              )}
              {can("editCustomers") && (
                <button
                  onClick={() => setEditing(c)}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-2 text-[11px] font-bold text-muted"
                >
                  Edit
                </button>
              )}
            </div>
          ))}
          {rows.length === 0 && (
            <p className="py-8 text-center text-muted">
              {search ? "No customer matches that." : "No customers yet — tap + New customer."}
            </p>
          )}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={`fixed right-4 top-4 z-50 max-w-[calc(100vw-2rem)] rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg sm:max-w-sm ${
            notice.ok ? "bg-ink" : "bg-danger"
          }`}
        >
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {reminding && (
        <ReminderConfirm
          customer={reminding}
          isAdmin={isAdmin}
          onClose={() => setReminding(null)}
          onDone={(n) => {
            setReminding(null);
            setNotice(n);
          }}
        />
      )}

      {viewing && <CustomerHistorySheet customer={viewing} isAdmin={isAdmin} onClose={() => setViewing(null)} />}

      {creating && <CustomerSheet onClose={() => setCreating(false)} />}
      {editing && (
        <CustomerSheet customer={editing} canDelete={isAdmin} canViewMobile={isAdmin} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Shows the exact text before it goes out — a reminder costs credit and can't be taken back. */
function ReminderConfirm({
  customer,
  isAdmin,
  onClose,
  onDone,
}: {
  customer: Customer;
  isAdmin: boolean;
  onClose: () => void;
  onDone: (notice: { ok: boolean; text: string }) => void;
}) {
  const { label } = useCustomerLabel();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await sendReminderSms({ customerId: customer.id });
      onDone({ ok: true, text: `Reminder sent to ${label(customer.name)}` });
    } catch (err) {
      // Kept in the sheet so the cashier sees why, e.g. "already reminded".
      setError((err as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface p-5">
        <h3 className="text-xl font-extrabold">Remind {label(customer.name)}?</h3>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
          {isAdmin ? `SMS to ${customer.mobileNumber}` : "SMS reminder"}
          {customer.lastReminderAt > 0 && <> · last reminded {dateAndTime(customer.lastReminderAt)}</>}
        </p>
        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-ground px-3.5 py-3 text-sm font-medium">
          {reminderPreview(label(customer.name), customer.remainingCredit, customer.autoNamed)}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="min-h-[52px] flex-1 rounded-2xl border border-border text-base font-bold text-muted"
          >
            Cancel
          </button>
          <button
            disabled={sending}
            onClick={handleSend}
            className="min-h-[52px] flex-[2] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send reminder"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One customer's statement: what they owe, their bills, their payments. */
function CustomerHistorySheet({
  customer,
  isAdmin,
  onClose,
}: {
  customer: Customer;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { label } = useCustomerLabel();
  const { bills, loading: billsLoading } = useCustomerBills(customer.id);
  const { payments, loading: paymentsLoading } = useCreditPayments(customer.id);

  const creditBills = bills.filter((b) => b.paymentType === "credit" && b.status !== "void");

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{label(customer.name)}</div>
            <div className="text-sm font-medium text-muted">
              {isAdmin ? `${customer.mobileNumber || "No mobile"} · ` : ""}
              {customer.type}
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
          <span className="tabular-nums text-xl font-extrabold text-warning">
            {money(customer.remainingCredit)}
          </span>
        </div>
        {customer.openingBalance > 0 && (
          <p className="tabular-nums mt-1 text-xs font-medium text-muted-2">
            Includes {money(customer.openingBalance)} carried over from the old app.
          </p>
        )}
        {customer.advance > 0 && (
          <div className="mt-2 flex items-center justify-between rounded-xl bg-success/5 px-3.5 py-3">
            <span className="text-sm font-semibold text-success">Advance held</span>
            <span className="tabular-nums text-xl font-extrabold text-success">{money(customer.advance)}</span>
          </div>
        )}

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Credit bills
        </div>
        {billsLoading ? (
          <p className="py-4 text-center text-muted">Loading…</p>
        ) : creditBills.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No credit bills.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {creditBills.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-xl border border-border px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">Bill {billLabel(b)}</div>
                  <div className="text-[11px] font-medium text-muted-2">{dateAndTime(b.createdAt)}</div>
                </div>
                <div className="tabular-nums text-right">
                  <div className="text-sm font-bold">{money(b.total)}</div>
                  <div
                    className={`text-[11px] font-bold ${b.due > 0 ? "text-warning" : "text-success"}`}
                  >
                    {b.due > 0 ? `${money(b.due)} due` : "Settled"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
          Payments
        </div>
        {paymentsLoading ? (
          <p className="py-4 text-center text-muted">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">No payments yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-border px-3.5 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{dateAndTime(p.createdAt)}</div>
                  <div className="text-[11px] font-medium text-muted-2">
                    {describePayment(p)}
                  </div>
                </div>
                <div className="tabular-nums text-sm font-extrabold text-success">
                  {money(p.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
