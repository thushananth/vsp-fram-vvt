"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Coins, Printer, ShieldCheck, ShieldHalf } from "lucide-react";
import { useAdminGate } from "@/components/AdminGate";
import ChangePasswordCard from "@/components/ChangePasswordCard";
import NumField from "@/components/ui/NumField";
import { useStoreSettings, saveStoreSettings, type StoreSettings } from "@/lib/firestore/settings";
import { setDeviceStatus } from "@/lib/firestore/devices";
import { collectDeviceDetails, getDeviceId } from "@/lib/device";
import { printTickets, usePrinter } from "@/lib/printer";
import { testTicket } from "@/lib/receipts";
import { money } from "@/lib/format";

const ROUND_OFF_PRESETS = [0, 10, 20, 50];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Row({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-[15px] font-bold">{title}</div>
        <div className="mt-0.5 text-xs font-medium leading-relaxed text-muted">{body}</div>
      </div>
      {children}
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Printer;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon size={17} strokeWidth={2.2} />
        </span>
        <h2 className="text-[15px] font-extrabold">{title}</h2>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const gate = useAdminGate("Settings", "Store settings stay with admins.");
  const { settings, loading } = useStoreSettings();
  const printer = usePrinter();
  // Only what the admin changed is held here; the rest falls through to the
  // live doc, so a change made on another till still shows.
  const [edits, setEdits] = useState<Partial<StoreSettings>>({});
  const [roundOffText, setRoundOffText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const draft: StoreSettings = { ...settings, ...edits };
  const dirty = (Object.keys(edits) as (keyof StoreSettings)[]).some((k) => edits[k] !== settings[k]);
  const set = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) =>
    setEdits((e) => ({ ...e, [key]: value }));

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      // Settings lives behind the device gate, so switching verification on
      // without trusting this browser first would lock the admin out of the
      // switch they just flipped.
      if (draft.deviceVerification && !settings.deviceVerification) {
        const deviceId = getDeviceId();
        if (deviceId) {
          await setDeviceStatus({ deviceId, status: "approved", details: collectDeviceDetails() });
        }
      }
      await saveStoreSettings(draft);
      setEdits({});
      setRoundOffText(null);
      setNotice({ ok: true, text: "Saved." });
    } catch (err) {
      setNotice({ ok: false, text: `Not saved — ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handlePrinter() {
    const result =
      printer.status === "connected"
        ? await printTickets([testTicket(draft.paperWidth)])
        : await printer.connect();
    setNotice(
      result.success
        ? { ok: true, text: printer.status === "connected" ? "Test page sent." : "Printer connected." }
        : { ok: false, text: `Printer — ${result.error}` },
    );
  }

  if (gate) return gate;

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
      <p className="text-sm font-medium text-muted">Printer, billing rules and security</p>

      {loading ? (
        <p className="py-8 text-center text-muted">Loading…</p>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          <Card icon={Printer} title="Receipt printer">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  printer.status === "connected" ? "bg-success" : printer.status === "checking" ? "bg-muted-2" : "bg-danger"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">
                  {printer.status === "connected"
                    ? printer.name
                    : printer.status === "unsupported"
                      ? "This browser can't print"
                      : printer.status === "checking"
                        ? "Checking…"
                        : "No printer connected"}
                </div>
                <div className="text-xs font-medium text-muted">
                  {printer.status === "unsupported"
                    ? "Use Chrome or Edge — printing goes straight over USB."
                    : printer.status === "connected"
                      ? "Ready on this device"
                      : "Plug in the USB printer, then connect it once on this device"}
                </div>
              </div>
              {(printer.status === "connected" || printer.status === "disconnected") && (
                <button
                  onClick={handlePrinter}
                  className={`min-h-[40px] shrink-0 rounded-xl px-4 text-sm font-bold ${
                    printer.status === "connected" ? "border border-border" : "bg-accent text-white"
                  }`}
                >
                  {printer.status === "connected" ? "Test page" : "Connect"}
                </button>
              )}
            </div>
            <Row title="Paper width" body="80 mm fits 48 characters a line, 58 mm fits 32.">
              <div className="flex shrink-0 gap-1 rounded-xl bg-ground p-1">
                {([58, 80] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => set("paperWidth", w)}
                    className={`min-h-[36px] rounded-lg px-3 text-[13px] font-bold ${
                      draft.paperWidth === w ? "bg-surface shadow-sm" : "text-muted"
                    }`}
                  >
                    {w} mm
                  </button>
                ))}
              </div>
            </Row>
            <Row
              title="Print on every sale"
              body="The default. A cashier can still switch it off for one bill in the basket."
            >
              <Switch label="Print on every sale" checked={draft.printBills} onChange={(v) => set("printBills", v)} />
            </Row>
            <Row
              title="Counter copy"
              body="A second ticket for the cutting counter, when a bill has items from a category marked “counter copy” under Products."
            >
              <Switch
                label="Counter copy"
                checked={draft.printCounterCopy}
                onChange={(v) => set("printCounterCopy", v)}
              />
            </Row>
          </Card>

          <Card icon={Coins} title="Walk-in round-off">
            <div className="px-4 py-3.5">
              <p className="text-xs font-medium leading-relaxed text-muted">
                How much a walk-in customer can pay short and still be charged. With{" "}
                {money(draft.walkInRoundOff || 10)}, a {money(1010)} bill paid with {money(1000)} is saved as a{" "}
                {money(1000)} bill and the {money(10)} is recorded as round-off. Set 0 to always ask for the full
                amount.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {ROUND_OFF_PRESETS.map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      set("walkInRoundOff", v);
                      setRoundOffText(null);
                    }}
                    className={`min-h-[42px] rounded-xl border px-4 text-sm font-bold ${
                      draft.walkInRoundOff === v ? "border-accent bg-accent text-white" : "border-border"
                    }`}
                  >
                    {v === 0 ? "Off" : `Rs ${v}`}
                  </button>
                ))}
                <label className="flex items-center gap-2 rounded-xl border border-border px-3">
                  <span className="text-sm font-semibold text-muted">Rs</span>
                  <NumField
                    integer
                    value={roundOffText ?? String(draft.walkInRoundOff)}
                    onValue={(v) => {
                      setRoundOffText(v);
                      if (v !== "") set("walkInRoundOff", Math.min(1000, Number(v) || 0));
                    }}
                    aria-label="Round-off limit in rupees"
                    className="tabular-nums h-[40px] w-16 bg-transparent text-right text-sm font-bold outline-none"
                  />
                </label>
              </div>
            </div>
          </Card>

          <Card icon={ShieldCheck} title="Security">
            <Row
              title="Approve every new device"
              body="A browser that has never been used can't open the till until an admin approves it (a 6-digit code is emailed to every admin). Turning this on approves the browser you're using now."
            >
              <Switch
                label="Approve every new device"
                checked={draft.deviceVerification}
                onChange={(v) => set("deviceVerification", v)}
              />
            </Row>
            <Link href="/permissions" className="flex items-center gap-3 px-4 py-3.5 hover:bg-ground">
              <ShieldHalf size={18} className="text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">Cashier permissions</div>
                <div className="text-xs font-medium text-muted">What cashiers can see and change</div>
              </div>
              <ChevronRight size={18} className="text-muted-2" />
            </Link>
          </Card>

          <h2 className="mt-2 text-[11px] font-bold uppercase tracking-wider text-muted-2">Account</h2>
          <ChangePasswordCard />
        </div>
      )}

      {/* Sticky save bar — only while there is something to save. */}
      {(dirty || notice) && (
        <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            {notice && (
              <span className={`flex-1 text-sm font-semibold ${notice.ok ? "text-success" : "text-danger"}`}>
                {notice.text}
              </span>
            )}
            {!notice && <span className="flex-1 text-sm font-medium text-muted">Unsaved changes</span>}
            {dirty && (
              <>
                <button
                  onClick={() => {
                    setEdits({});
                    setRoundOffText(null);
                  }}
                  className="min-h-[44px] rounded-xl px-4 text-sm font-bold text-muted"
                >
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
            )}
            {!dirty && notice && (
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
