"use client";

import { useMemo, useState } from "react";
import { useCustomers, matchesCustomerSearch } from "@/lib/firestore/customers";
import CustomerSheet from "@/components/CustomerSheet";
import { useCustomerBills } from "@/lib/firestore/bills";
import { useCreditPayments } from "@/lib/firestore/credit";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/lib/firestore/permissions";
import { dateAndTime, money } from "@/lib/format";
import type { Customer, CustomerType } from "@/lib/types";

export default function CustomersPage() {
  const { customers, loading } = useCustomers();
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);

  const isAdmin = profile?.role === "admin";
  const { can } = useCan();

  const rows = useMemo(
    () => customers.filter((c) => matchesCustomerSearch(c, search)),
    [customers, search],
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
        placeholder="Search by name or mobile"
        className="mt-3 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-accent"
      />

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((c) => (
            <div
              key={c.id}
              className="flex min-h-[72px] items-center gap-2 rounded-2xl border border-border bg-surface px-3.5 py-3"
            >
              <button onClick={() => setViewing(c)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate text-base font-bold">{c.name}</span>
                  <span className="shrink-0 rounded-md bg-ground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    {c.type}
                  </span>
                </div>
                <div className="text-xs font-medium text-muted-2">
                  {c.mobileNumber || "No mobile"}
                </div>
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
              </div>
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

      {viewing && <CustomerHistorySheet customer={viewing} onClose={() => setViewing(null)} />}

      {creating && <CustomerSheet onClose={() => setCreating(false)} />}
      {editing && (
        <CustomerSheet customer={editing} canDelete={isAdmin} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** One customer's statement: what they owe, their bills, their payments. */
function CustomerHistorySheet({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { bills, loading: billsLoading } = useCustomerBills(customer.id);
  const { payments, loading: paymentsLoading } = useCreditPayments(customer.id);

  const creditBills = bills.filter((b) => b.paymentType === "credit" && b.status !== "void");

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{customer.name}</div>
            <div className="text-sm font-medium text-muted">
              {customer.mobileNumber || "No mobile"} · {customer.type}
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
                  <div className="text-sm font-bold">Bill #{b.no}</div>
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
                    {p.allocations
                      .map((a) => (a.billNo ? `#${a.billNo}` : "Opening"))
                      .join(", ")}
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
