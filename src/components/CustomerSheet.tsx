"use client";

import { useState } from "react";
import {
  createCustomer,
  updateCustomer,
  deactivateCustomer,
  useCustomers,
  mobileKey,
  isTenDigitMobile,
  customerWithMobile,
} from "@/lib/firestore/customers";
import { money } from "@/lib/format";
import { isNumberName } from "@/lib/firestore/customers";
import { WALK_IN_LABEL, useCustomerLabel } from "@/lib/customerName";
import type { Customer, CustomerType } from "@/lib/types";

export default function CustomerSheet({
  customer,
  canDelete = false,
  canViewMobile = true,
  onClose,
  onCreated,
}: {
  customer?: Customer;
  canDelete?: boolean;
  /** Cashiers editing an existing customer never see or change the number. */
  canViewMobile?: boolean;
  onClose: () => void;
  onCreated?: (customer: { id: string; name: string; type: CustomerType; mobileNumber: string }) => void;
}) {
  // A cashier editing a walk-in stored under their number must not see it: the name box
  // starts empty and an empty box leaves the stored name alone.
  const nameHidden = !!customer && !canViewMobile && isNumberName(customer.name);
  const [name, setName] = useState(nameHidden ? "" : (customer?.name ?? ""));
  const [type, setType] = useState<CustomerType>(customer?.type ?? "person");
  const [mobileNumber, setMobileNumber] = useState(customer ? mobileKey(customer.mobileNumber) : "");
  const showMobile = !customer || canViewMobile;
  // Save waits for the list: an empty list would let a duplicate number through.
  const { customers, loading: customersLoading } = useCustomers();
  const { label } = useCustomerLabel();
  // A customer added from here needs a number; one already on file without a
  // number may stay that way, but any number typed must be all ten digits.
  const mobileRequired = !customer || mobileKey(customer.mobileNumber) !== "";
  const mobileBad = showMobile && (mobileNumber !== "" || mobileRequired) && !isTenDigitMobile(mobileNumber);
  const takenBy = showMobile && isTenDigitMobile(mobileNumber) ? customerWithMobile(customers, mobileNumber, customer?.id) : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mobileBad) {
      setError("Mobile must be exactly 10 digits.");
      return;
    }
    if (customersLoading) return;
    if (takenBy) {
      setError(`This number already belongs to ${label(takenBy.name)}.`);
      return;
    }
    setSaving(true);
    try {
      const fields = { name: name.trim(), type, mobileNumber: mobileNumber.trim() };
      if (customer) {
        await updateCustomer(
          customer.id,
          {
            ...(nameHidden && !fields.name ? {} : { name: fields.name }),
            type,
            ...(showMobile && { mobileNumber: fields.mobileNumber }),
          },
        );
      } else {
        const id = await createCustomer(fields);
        onCreated?.({ id, ...fields });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!customer) return;
    setSaving(true);
    try {
      await deactivateCustomer(customer.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <form
        onSubmit={handleSave}
        className="mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-3xl bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-extrabold">{customer ? "Edit customer" : "New customer"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        <div className="flex gap-1.5 rounded-xl bg-ground p-1">
          {(["person", "shop"] as CustomerType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`min-h-[42px] flex-1 rounded-lg text-sm font-bold capitalize ${
                type === t ? "bg-white shadow-sm" : "text-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Name
          <input
            required={!nameHidden}
            autoFocus
            placeholder={nameHidden ? WALK_IN_LABEL : undefined}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
          />
        </label>

        {showMobile && <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Mobile (10 digits)
          <input
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            maxLength={10}
            required={mobileRequired}
            placeholder="07XXXXXXXX"
            className={`rounded-xl border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent ${
              mobileNumber && mobileBad ? "border-warning" : "border-border"
            }`}
          />
          {mobileNumber !== "" && mobileBad && (
            <span className="tabular-nums text-xs font-semibold text-warning">
              {mobileNumber.length} of 10 digits
            </span>
          )}
          {takenBy && (
            <span className="text-xs font-semibold text-warning">
              Already saved as {label(takenBy.name)} — one customer per number.
            </span>
          )}
        </label>}

        {customer && customer.remainingCredit > 0 && (
          <p className="tabular-nums rounded-xl bg-warning/5 px-3.5 py-3 text-sm font-semibold text-warning">
            Owes {money(customer.remainingCredit)} — settle it on the Credit screen, not here.
          </p>
        )}

        {customer && customer.advance > 0 && (
          <p className="tabular-nums rounded-xl bg-success/5 px-3.5 py-3 text-sm font-semibold text-success">
            Holds {money(customer.advance)} advance — taken off their next bill at the till, or used from the Credit screen.
          </p>
        )}

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={saving || customersLoading || mobileBad || takenBy !== null}
          className="mt-2 min-h-[52px] rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : customer ? "Save changes" : "Create customer"}
        </button>

        {customer && canDelete && customer.remainingCredit <= 0 && customer.advance <= 0 && (
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={saving}
            className="min-h-[46px] rounded-xl border border-danger/30 text-sm font-bold text-danger disabled:opacity-50"
          >
            Remove customer
          </button>
        )}
      </form>
    </div>
  );
}
