"use client";

import { useState } from "react";
import { BarChart3, ClipboardList, Contact, Package, Receipt, RotateCcw, type LucideIcon } from "lucide-react";
import { useAdminGate } from "@/components/AdminGate";
import {
  DEFAULT_PERMISSIONS,
  PERMISSION_GROUPS,
  savePermissions,
  usePermissions,
  type CashierPermissions,
  type PermissionKey,
} from "@/lib/firestore/permissions";

const GROUP_ICONS: Record<string, LucideIcon> = {
  billing: Receipt,
  bills: ClipboardList,
  customers: Contact,
  products: Package,
  reports: BarChart3,
};

const ALL_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export default function PermissionsPage() {
  const gate = useAdminGate("Permissions", "Only an admin decides what cashiers can do.");
  const { permissions, loading } = usePermissions();
  const [edits, setEdits] = useState<Partial<CashierPermissions>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const draft: CashierPermissions = { ...permissions, ...edits };
  const changed = ALL_KEYS.filter((k) => draft[k] !== permissions[k]);
  const allowed = ALL_KEYS.filter((k) => draft[k]).length;

  function set(keys: PermissionKey[], value: boolean) {
    setNotice(null);
    setEdits((e) => ({ ...e, ...Object.fromEntries(keys.map((k) => [k, value])) }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await savePermissions(draft);
      setEdits({});
      setNotice({ ok: true, text: "Saved — cashiers see the change straight away." });
    } catch (err) {
      setNotice({ ok: false, text: `Not saved — ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  if (gate) return gate;

  return (
    <div className="mx-auto max-w-3xl p-4 pb-32">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Cashier permissions</h1>
          <p className="text-sm font-medium text-muted">
            Admins can always do everything. These decide what a cashier account can do.
          </p>
        </div>
        <button
          onClick={() => {
            setNotice(null);
            setEdits(
              Object.fromEntries(ALL_KEYS.map((k) => [k, DEFAULT_PERMISSIONS[k]])) as Partial<CashierPermissions>,
            );
          }}
          className="flex min-h-[40px] items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-[13px] font-bold text-muted"
        >
          <RotateCcw size={14} /> Recommended
        </button>
      </div>

      {/* At-a-glance meter of how open the till is. */}
      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold">
            {allowed} of {ALL_KEYS.length} allowed
          </span>
          <span className="text-xs font-semibold text-muted">
            {changed.length > 0 ? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}` : "Up to date"}
          </span>
        </div>
        <div className="mt-2.5 flex gap-1">
          {ALL_KEYS.map((k) => (
            <span
              key={k}
              className={`h-1.5 flex-1 rounded-full ${draft[k] ? "bg-accent" : "bg-border"} ${
                changed.includes(k) ? "ring-2 ring-warning/60" : ""
              }`}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => {
            const Icon = GROUP_ICONS[group.id] ?? Receipt;
            const keys = group.items.map((i) => i.key);
            const on = keys.filter((k) => draft[k]).length;
            const allOn = on === keys.length;
            return (
              <section
                key={group.id}
                className={`overflow-hidden rounded-2xl border border-border bg-surface ${
                  group.items.length > 3 ? "md:row-span-2" : ""
                }`}
              >
                <div className="flex items-center gap-3 px-4 pb-2 pt-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
                    <Icon size={19} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-extrabold">{group.title}</h2>
                    <p className="text-xs font-semibold text-muted">
                      {group.blurb} · {on}/{keys.length} on
                    </p>
                  </div>
                  {keys.length > 1 && (
                    <button
                      onClick={() => set(keys, !allOn)}
                      className="min-h-[34px] rounded-lg bg-ground px-3 text-xs font-bold text-muted"
                    >
                      {allOn ? "None" : "All"}
                    </button>
                  )}
                </div>
                <div className="flex flex-col p-2">
                  {group.items.map((item) => {
                    const checked = draft[item.key];
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        onClick={() => set([item.key], !checked)}
                        className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-ground"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-bold">
                            {item.label}
                            {changed.includes(item.key) && (
                              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="changed" />
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs font-medium leading-relaxed text-muted">
                            {item.body}
                          </span>
                        </span>
                        <span
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                            checked ? "bg-accent" : "bg-border"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              checked ? "translate-x-[22px]" : "translate-x-0.5"
                            }`}
                          />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {(changed.length > 0 || notice) && (
        <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <span
              className={`flex-1 text-sm font-semibold ${
                notice ? (notice.ok ? "text-success" : "text-danger") : "text-muted"
              }`}
            >
              {notice?.text ?? `${changed.length} unsaved change${changed.length === 1 ? "" : "s"}`}
            </span>
            {changed.length > 0 ? (
              <>
                <button onClick={() => setEdits({})} className="min-h-[44px] rounded-xl px-4 text-sm font-bold text-muted">
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="min-h-[44px] rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button onClick={() => setNotice(null)} className="text-sm font-bold text-muted underline">
                OK
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
