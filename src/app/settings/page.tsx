"use client";

import { useState } from "react";
import { useAdminGate } from "@/components/AdminGate";
import { usePermissions, savePermissions, type CashierPermissions } from "@/lib/firestore/permissions";
import { useStoreSettings, saveStoreSettings, type StoreSettings } from "@/lib/firestore/settings";
import { setDeviceStatus } from "@/lib/firestore/devices";
import { collectDeviceDetails, getDeviceId } from "@/lib/device";

const STORE_TOGGLES: { key: keyof StoreSettings; label: string; body: string }[] = [
  {
    key: "printBills",
    label: "Print bill on charge",
    body: "Auto-print a receipt on the thermal printer every time a sale is charged. Turn this off to run without a printer — bills are still saved, and can be reprinted later from Bills.",
  },
];

const SECURITY_TOGGLES: { key: keyof StoreSettings; label: string; body: string }[] = [
  {
    key: "deviceVerification",
    label: "Approve every new device",
    body: "A browser that has never been used before can't open the till — not by signing in, not by typing a URL. Every admin is emailed a 6-digit code with the device details, and the device stays locked until someone types that code or approves it under Devices. Turning this on approves the browser you're using right now, so you can't lock yourself out.",
  },
];

const TOGGLES: { key: keyof CashierPermissions; label: string; body: string }[] = [
  {
    key: "voidBills",
    label: "Delete bills",
    body: "Let cashiers delete a bill from the Bills screen, not just admins.",
  },
  {
    key: "reprintBills",
    label: "Reprint bills",
    body: "Let cashiers reprint a past receipt from the Bills screen.",
  },
  {
    key: "editStockPrices",
    label: "Edit stock prices",
    body: "Let cashiers change price-each when recording stock (Stock → tap an item).",
  },
  {
    key: "editBillPrices",
    label: "Change a price on the bill",
    body: "Let cashiers override what a line is charged at while billing (tap the line on the bill) — a special price for a regular customer, say. The product's own price is never touched, and the normal price is recorded on the line so the discount shows in the bill history.",
  },
  {
    key: "createStockItems",
    label: "Create new stock items",
    body: "Let cashiers add brand-new farm products / barcoded goods from Stock → New item.",
  },
  {
    key: "addStock",
    label: "Add stock quantity",
    body: "Let cashiers add incoming stock quantities to existing items.",
  },
  {
    key: "viewReports",
    label: "View day reports",
    body: "Let cashiers open the Report screen. Dashboard stays admin-only regardless.",
  },
  {
    key: "viewStockReport",
    label: "View stock report & history",
    body: "Let cashiers open Stock → Report and Stock → History, including stock value and cost.",
  },
];

function Toggle({
  label,
  body,
  checked,
  onChange,
}: {
  label: string;
  body: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-bold">{label}</div>
        <div className="mt-0.5 text-xs font-medium leading-relaxed text-muted">{body}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors checked:bg-accent relative
          before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:shadow before:transition-transform checked:before:translate-x-5"
      />
    </label>
  );
}

export default function SettingsPage() {
  const gate = useAdminGate("Settings", "Store settings and cashier permissions stay with admins.");
  const { permissions, loading: permissionsLoading } = usePermissions();
  const { settings, loading: settingsLoading } = useStoreSettings();
  // Only the toggles the admin actually flipped are held in state; everything
  // else falls through to the live doc, so a change made elsewhere still shows.
  const [edits, setEdits] = useState<Partial<CashierPermissions>>({});
  const [storeEdits, setStoreEdits] = useState<Partial<StoreSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: CashierPermissions = { ...permissions, ...edits };
  const storeDraft: StoreSettings = { ...settings, ...storeEdits };


  const loading = permissionsLoading || settingsLoading;
  const permissionsDirty = TOGGLES.some((t) => draft[t.key] !== permissions[t.key]);
  const storeDirty = [...STORE_TOGGLES, ...SECURITY_TOGGLES].some(
    (t) => storeDraft[t.key] !== settings[t.key],
  );
  const dirty = permissionsDirty || storeDirty;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Settings lives behind the device gate, so switching verification on
      // without trusting this browser first would lock the admin out of the
      // switch they just flipped.
      if (storeDraft.deviceVerification && !settings.deviceVerification) {
        const deviceId = getDeviceId();
        if (deviceId) {
          await setDeviceStatus({
            deviceId,
            status: "approved",
            details: collectDeviceDetails(),
          });
        }
      }
      if (storeDirty) await saveStoreSettings(storeDraft);
      if (permissionsDirty) await savePermissions(draft);
      setStoreEdits({});
      setEdits({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }


  // Denied by default until the profile says otherwise.
  if (gate) return gate;

  return (
    <div className="mx-auto max-w-2xl p-4 pb-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
      <p className="text-sm font-medium text-muted">Printing, security &amp; cashier permissions</p>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">Printing</h2>
          {STORE_TOGGLES.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              body={t.body}
              checked={storeDraft[t.key]}
              onChange={(value) => setStoreEdits((d) => ({ ...d, [t.key]: value }))}
            />
          ))}

          <h2 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
            Security
          </h2>
          {SECURITY_TOGGLES.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              body={t.body}
              checked={storeDraft[t.key]}
              onChange={(value) => setStoreEdits((d) => ({ ...d, [t.key]: value }))}
            />
          ))}

          <h2 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-muted-2">
            Cashier permissions
          </h2>
          {TOGGLES.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              body={t.body}
              checked={draft[t.key]}
              onChange={(value) => setEdits((d) => ({ ...d, [t.key]: value }))}
            />
          ))}

          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="min-h-[48px] rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {saved && <span className="text-sm font-semibold text-success">Saved.</span>}
            {error && (
              <span className="text-sm font-semibold text-danger">Not saved — {error}</span>
            )}
          </div>

          <p className="mt-4 text-xs font-medium leading-relaxed text-muted-2">
            Printing is a store-wide setting — it applies to admins too. The cashier permissions
            below only widen or narrow what a <span className="font-bold">cashier</span> account can
            do; admins can always do everything, everywhere.
          </p>
        </div>
      )}
    </div>
  );
}
