"use client";

import { useEffect, useRef, useState } from "react";
import { Footprints, Search, UserPlus, X } from "lucide-react";
import {
  useCustomers,
  matchesCustomerSearch,
  startCreateCustomer,
  updateCustomer,
  isNumberName,
  mobileKey,
  isTenDigitMobile,
  customerWithMobile,
} from "@/lib/firestore/customers";
import { useCustomerLabel } from "@/lib/customerName";
import { SkeletonRows } from "@/components/ui/Skeleton";
import type { Customer, CustomerType } from "@/lib/types";

/** Saved with only a number — the cashier may give them a name. */
const nameless = (c: Customer) => c.autoNamed || isNumberName(c.name);

/**
 * The first screen of every bill: who is it for? Walk-in is already selected,
 * so a cash sale is one tap. A regular is found by name; someone new is added
 * right here, prefilled from what was searched. Cashiers never see a stored
 * number — a number only finds a customer when all ten digits are typed, and
 * then only their name is shown.
 */
export default function CustomerStart({
  selectedId,
  changing,
  cartCount,
  billNo,
  onPick,
  onBack,
  onScan,
  onError,
}: {
  selectedId: string | null;
  /** Opened from a bill already being built — picking goes back to it. */
  changing: boolean;
  cartCount: number;
  billNo?: number;
  onPick: (customer: Customer | null) => void;
  onBack: () => void;
  /** A barcode arriving here. True when it was a product (a walk-in bill is started). */
  onScan: (code: string) => boolean;
  onError: (message: string) => void;
}) {
  const { customers, loading } = useCustomers();
  const { isAdmin, label } = useCustomerLabel();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  /** null until the cashier touches the form — until then it follows the search. */
  const [draft, setDraft] = useState<{ type: CustomerType; name: string; mobile: string } | null>(null);
  const [rename, setRename] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const q = search.trim();
  const numeric = q !== "" && /^[\d\s+()-]+$/.test(q);
  const digits = q.replace(/\D/g, "");
  const typedNumber = numeric ? mobileKey(q) : "";
  const fullNumber = numeric && isTenDigitMobile(typedNumber);
  const exact = fullNumber ? customerWithMobile(customers, typedNumber) : null;

  const rows: Customer[] = !q
    ? isAdmin
      ? customers
      : customers.filter((c) => !nameless(c))
    : numeric
      ? isAdmin
        ? digits.length >= 3
          ? customers.filter((c) => mobileKey(c.mobileNumber).includes(digits))
          : []
        : exact
          ? [exact]
          : []
      : customers.filter((c) => matchesCustomerSearch(c, q, isAdmin));

  const form = {
    type: draft?.type ?? "person",
    name: draft?.name ?? (numeric ? "" : q),
    mobile: draft?.mobile ?? (numeric ? typedNumber.slice(0, 10) : ""),
  };
  const formMobileOk = isTenDigitMobile(form.mobile);
  const formTaken = formMobileOk ? customerWithMobile(customers, form.mobile) : null;
  const incomplete = numeric && !fullNumber && (!isAdmin || digits.length < 3);
  const showForm = q !== "" && (adding || (!loading && rows.length === 0 && (!numeric || fullNumber)));
  const namingCard = exact && nameless(exact) ? exact : null;

  function changeSearch(value: string) {
    setSearch(value);
    setAdding(false);
    setDraft(null);
    setRename("");
  }

  function editForm(patch: Partial<typeof form>) {
    setDraft({ ...form, ...patch });
  }

  function saveNew() {
    if (loading || !formMobileOk || formTaken) return;
    const name = form.name.trim();
    const fields = { name: name || form.mobile, type: form.type, mobileNumber: form.mobile, autoNamed: !name };
    // Queued, not awaited: the till keeps working with no connection.
    const { id, saved, createdAt } = startCreateCustomer(fields);
    saved.catch((err: Error) => onError(`Customer not saved — ${err.message}`));
    onPick({
      id,
      ...fields,
      remainingCredit: 0,
      openingBalance: 0,
      advance: 0,
      lastReminderAt: 0,
      active: true,
      createdAt,
      updatedAt: createdAt,
    });
  }

  /** Give a number-only customer their name — the same customer, never a second one. */
  function nameAndPick(c: Customer, rawName: string) {
    const name = rawName.trim();
    if (!name) return;
    updateCustomer(c.id, { name, type: c.type }).catch((err: Error) =>
      onError(`Name not saved — ${err.message}`),
    );
    onPick({ ...c, name, autoNamed: false });
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q) return;
    // A scanner sends Enter: a product barcode starts a walk-in bill with it.
    if (onScan(q)) return;
    if (rows.length === 1 && !namingCard) onPick(rows[0]);
  }

  // Nothing focused: a key typed (or scanned) lands in the search box.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && changing) {
        onBack();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      changeSearch(search + e.key);
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const walkInSelected = selectedId === null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold">{changing ? "Change customer" : "New bill"}</h2>
        {changing ? (
          <button
            onClick={onBack}
            className="min-h-[44px] rounded-xl border border-border bg-surface px-4 text-sm font-bold text-muted"
          >
            Back to bill · {cartCount} item{cartCount === 1 ? "" : "s"}
          </button>
        ) : (
          billNo !== undefined && <span className="tabular-nums text-sm font-bold text-muted">#{billNo}</span>
        )}
      </div>

      <button
        onClick={() => onPick(null)}
        className={`flex w-full items-center gap-4 rounded-2xl border-2 bg-surface p-4 text-left transition-transform active:scale-[0.99] ${
          walkInSelected ? "border-accent" : "border-border"
        }`}
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
          <Footprints className="h-7 w-7" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xl font-extrabold">
            Walk-in
            {walkInSelected && (
              <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
                Selected
              </span>
            )}
          </span>
          <span className="block text-sm font-semibold text-muted">Pays now. No account, no number needed.</span>
        </span>
        <span className="shrink-0 rounded-2xl bg-accent px-5 py-3.5 text-base font-extrabold text-white">
          {changing ? "Bill as walk-in" : "Start bill ›"}
        </span>
      </button>

      <div className="flex items-center gap-3 text-xs font-bold text-muted-2">
        <span className="h-px flex-1 bg-border" />
        or bill a customer
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={submitSearch} className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
          placeholder={isAdmin ? "Find a customer by name or mobile" : "Find a customer by name"}
          aria-label="Find customer"
          autoComplete="off"
          className="w-full rounded-2xl border border-border bg-surface py-4 pl-11 pr-11 text-base outline-none focus:border-accent"
        />
        {search && (
          <button
            type="button"
            onClick={() => changeSearch("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-2"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {!q && <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted-2">Customers</p>}

      {loading ? (
        <SkeletonRows rows={4} label="Loading customers" />
      ) : (
        rows.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                className={`flex min-h-[64px] items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 text-left active:scale-[0.99] ${
                  selectedId === c.id ? "border-accent bg-accent/5" : "border-border"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-ground font-extrabold text-muted ${
                    c.type === "shop" ? "rounded-full" : "rounded-xl"
                  }`}
                >
                  {(label(c.name).trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{label(c.name)}</span>
                  <span className="block truncate text-xs font-semibold text-muted">
                    {c.type === "shop" ? "Shop" : "Person"}
                    {isAdmin && ` · ${c.mobileNumber || "No mobile"}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {c.remainingCredit > 0 && (
                    <span className="tabular-nums rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-extrabold text-warning">
                      owes {c.remainingCredit.toFixed(0)}
                    </span>
                  )}
                  {c.advance > 0 && (
                    <span className="tabular-nums rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-extrabold text-success">
                      advance {c.advance.toFixed(0)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )
      )}

      {incomplete && (
        <p className="text-sm font-semibold text-muted">
          {isAdmin
            ? "Keep typing the number."
            : `${digits.length} of 10 digits. Type the full number to find a customer by mobile.`}
        </p>
      )}

      {namingCard && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-accent bg-surface p-4">
          <h3 className="text-lg font-extrabold">This number has no name yet</h3>
          <label className="flex flex-col gap-1.5 text-sm font-bold">
            Name
            <input
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") nameAndPick(namingCard, rename);
              }}
              placeholder="Type their name"
              autoComplete="off"
              className="rounded-xl border border-border bg-ground px-3 py-3 text-base font-medium outline-none focus:border-accent"
            />
          </label>
          <p className="text-xs font-semibold text-muted">The name is saved to this number. No new customer is made.</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => nameAndPick(namingCard, rename)}
              disabled={!rename.trim()}
              className="min-h-[52px] rounded-2xl bg-accent text-base font-extrabold text-white disabled:opacity-45"
            >
              Save name and bill
            </button>
            <button
              onClick={() => onPick(namingCard)}
              className="min-h-[52px] rounded-2xl border-2 border-border text-base font-extrabold"
            >
              Bill without name
            </button>
          </div>
        </div>
      )}

      {q && !loading && !namingCard && !incomplete && !showForm && (
        <button
          onClick={() => setAdding(true)}
          className="flex min-h-[60px] items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-accent bg-accent/5 px-4 text-left text-base font-extrabold text-accent"
        >
          <UserPlus className="h-5 w-5 shrink-0" />
          <span className="min-w-0 truncate">Add “{q}” as a new customer</span>
        </button>
      )}

      {showForm && !namingCard && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-accent bg-surface p-4">
          <h3 className="text-lg font-extrabold">New customer</h3>
          <div className="flex gap-1.5 rounded-xl bg-ground p-1">
            {(["person", "shop"] as CustomerType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => editForm({ type: t })}
                className={`min-h-[42px] flex-1 rounded-lg text-sm font-bold capitalize ${
                  form.type === t ? "bg-surface shadow-sm" : "text-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              Name
              <input
                value={form.name}
                onChange={(e) => editForm({ name: e.target.value })}
                placeholder={form.type === "shop" ? "Shop name" : "Optional"}
                autoComplete="off"
                className="rounded-xl border border-border bg-ground px-3 py-3 text-base font-medium outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              Mobile (10 digits)
              <input
                value={form.mobile}
                onChange={(e) => editForm({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                inputMode="numeric"
                maxLength={10}
                placeholder="07XXXXXXXX"
                autoComplete="off"
                className={`tabular-nums rounded-xl border bg-ground px-3 py-3 text-base font-medium outline-none focus:border-accent ${
                  form.mobile && !formMobileOk ? "border-warning" : formMobileOk && !formTaken ? "border-success" : "border-border"
                }`}
              />
            </label>
          </div>

          {formTaken ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-sm font-bold text-success">
              <span>
                {nameless(formTaken)
                  ? "This number is already saved, with no name."
                  : `This number is already ${label(formTaken.name)}.`}
              </span>
              {nameless(formTaken) && form.name.trim() ? (
                <button
                  onClick={() => nameAndPick(formTaken, form.name)}
                  className="rounded-lg bg-success px-3 py-2 text-sm font-extrabold text-white"
                >
                  Save “{form.name.trim()}” to it
                </button>
              ) : (
                <button
                  onClick={() => onPick(formTaken)}
                  className="rounded-lg bg-success px-3 py-2 text-sm font-extrabold text-white"
                >
                  Use this customer
                </button>
              )}
            </div>
          ) : (
            <p className="tabular-nums text-xs font-semibold text-muted">
              {!form.mobile
                ? "Mobile is required: all 10 digits."
                : !formMobileOk
                  ? `${form.mobile.length} of 10 digits. Type the full number.`
                  : !form.name.trim()
                    ? "Saved with no name. A name can be added later by typing this number."
                    : "One customer per number."}
            </p>
          )}

          <button
            onClick={saveNew}
            disabled={loading || !formMobileOk || formTaken !== null}
            className="min-h-[56px] rounded-2xl bg-accent text-base font-extrabold text-white disabled:opacity-45"
          >
            {changing ? "Add and use on this bill" : "Add and start bill"}
          </button>
        </div>
      )}
    </div>
  );
}
