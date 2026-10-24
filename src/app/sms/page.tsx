"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, MessageSquare, Send } from "lucide-react";
import { useAdminGate } from "@/components/AdminGate";
import { useAuth } from "@/lib/auth";
import { matchesCustomerSearch, useCustomers } from "@/lib/firestore/customers";
import {
  SMS_CONTACT_LINE,
  SMS_MAX_LENGTH,
  SMS_SHOP_NAME,
  countPromoRecipients,
  normalizeMobile,
  promoText,
  sendPromoSms,
  smsSegments,
  type PromoAudience,
} from "@/lib/sms";

/** "pick" sends only to the customers ticked in the list below. */
type Audience = PromoAudience | "pick";

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "shop", label: "Shops" },
  { value: "person", label: "People" },
  { value: "pick", label: "Choose" },
];

const PICK_FILTERS: { value: PromoAudience; label: string }[] = [
  { value: "all", label: "All" },
  { value: "shop", label: "Shops" },
  { value: "person", label: "People" },
];

export default function SmsPage() {
  const gate = useAdminGate("SMS", "Sending promotions stays with admins.");
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const { customers } = useCustomers();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickSearch, setPickSearch] = useState("");
  const [pickType, setPickType] = useState<PromoAudience>("all");
  const [withContact, setWithContact] = useState(true);
  const [counts, setCounts] = useState<Record<PromoAudience, number> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    countPromoRecipients()
      .then(({ data }) => setCounts(data))
      .catch((err: Error) => setNotice({ ok: false, text: `Couldn't count recipients — ${err.message}` }));
  }, [isAdmin]);

  // Everything below measures the text as it will actually go out, contact line included.
  const finalText = promoText(message, withContact);
  // Only customers a text can reach are listed for picking.
  const reachable = useMemo(
    () => customers.flatMap((c) => {
      const n = normalizeMobile(c.mobileNumber);
      return n ? [{ customer: c, mobile: n }] : [];
    }),
    [customers],
  );
  const pickList = reachable.filter(
    ({ customer }) =>
      (pickType === "all" || customer.type === pickType) && matchesCustomerSearch(customer, pickSearch),
  );
  const allListedPicked = pickList.length > 0 && pickList.every(({ customer }) => picked.has(customer.id));
  // Two picked customers sharing a number get one text — the server dedupes the same way.
  const pickedNumbers = new Set(reachable.filter(({ customer }) => picked.has(customer.id)).map((r) => r.mobile));
  const recipients = audience === "pick" ? pickedNumbers.size : (counts?.[audience] ?? 0);

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllListed() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const { customer } of pickList) {
        if (allListedPicked) next.delete(customer.id);
        else next.add(customer.id);
      }
      return next;
    });
  }
  const audienceLabel = audience === "pick" ? "Chosen customers" : AUDIENCES.find((a) => a.value === audience)!.label;
  const { segments, unicode } = smsSegments(finalText);
  const tooLong = finalText.length > SMS_MAX_LENGTH;
  const canSend = message.trim().length > 0 && !tooLong && !sending && recipients > 0;

  async function handleSend() {
    setConfirming(false);
    setSending(true);
    setNotice(null);
    try {
      const { data } = await sendPromoSms(
        audience === "pick"
          ? { message: message.trim(), audience: "all", withContact, customerIds: [...picked] }
          : { message: message.trim(), audience, withContact },
      );
      setNotice(
        data.failed > 0
          ? { ok: false, text: `Sent to ${data.sent}, failed for ${data.failed}. Check the SMSlenz balance and try again.` }
          : { ok: true, text: `Sent to ${data.sent} numbers.` },
      );
      if (data.failed === 0) setMessage("");
    } catch (err) {
      setNotice({ ok: false, text: `Not sent — ${(err as Error).message}` });
    } finally {
      setSending(false);
    }
  }

  if (gate) return gate;

  return (
    <div className="mx-auto max-w-2xl p-4 pb-28">
      <h1 className="text-2xl font-extrabold tracking-tight">SMS promotion</h1>
      <p className="text-sm font-medium text-muted">One message to every customer of the type you pick</p>

      <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <MessageSquare size={17} strokeWidth={2.2} />
          </span>
          <h2 className="flex-1 text-[15px] font-extrabold">Compose</h2>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">Send to</div>
            <div className="flex gap-1 rounded-xl bg-ground p-1">
              {AUDIENCES.map((a) => (
                <button
                  key={a.value}
                  onClick={() => setAudience(a.value)}
                  className={`min-h-[40px] flex-1 rounded-lg px-2 text-[13px] font-bold ${
                    audience === a.value ? "bg-surface shadow-sm" : "text-muted"
                  }`}
                >
                  {a.label}
                  <span className="tabular-nums ml-1 text-muted-2">
                    {a.value === "pick" ? pickedNumbers.size : counts ? counts[a.value] : "…"}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] font-medium text-muted-2">
              Only customers with a valid mobile number are counted. Walk-ins saved at the till are people.
            </p>
          </div>

          {audience === "pick" && (
            <div className="rounded-xl border border-border">
              <div className="flex flex-col gap-2 border-b border-border p-2.5">
                <input
                  value={pickSearch}
                  onChange={(e) => setPickSearch(e.target.value)}
                  placeholder="Search by name or mobile"
                  className="w-full rounded-lg border border-border bg-ground px-3 py-2 text-base outline-none focus:border-accent"
                />
                <div className="flex items-center gap-1.5">
                  {PICK_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setPickType(f.value)}
                      className={`min-h-[34px] rounded-lg px-3 text-xs font-bold ${
                        pickType === f.value ? "bg-accent text-white" : "bg-ground text-muted"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                  <span className="flex-1" />
                  <button
                    onClick={toggleAllListed}
                    disabled={pickList.length === 0}
                    className="min-h-[34px] rounded-lg border border-border px-3 text-xs font-bold text-muted disabled:opacity-50"
                  >
                    {allListedPicked ? "Clear these" : `Select these (${pickList.length})`}
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {pickList.map(({ customer }) => {
                  const on = picked.has(customer.id);
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => togglePick(customer.id)}
                      className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                          on ? "border-accent bg-accent text-white" : "border-border"
                        }`}
                      >
                        {on && <Check size={14} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {customer.autoNamed ? "Walk-in" : customer.name}
                        </span>
                        <span className="tabular-nums block text-xs font-medium text-muted-2">{customer.mobileNumber}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-ground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                        {customer.type}
                      </span>
                    </button>
                  );
                })}
                {pickList.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted">No customer with a mobile matches.</p>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs font-bold">
                <span>{picked.size} selected</span>
                {picked.size > 0 && (
                  <button onClick={() => setPicked(new Set())} className="text-muted underline">
                    Clear all
                  </button>
                )}
              </div>
            </div>
          )}

          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={`Fresh chicken 10% off this weekend at ${SMS_SHOP_NAME}!`}
            className="w-full resize-y rounded-xl border border-border bg-ground px-3.5 py-3 text-[15px] font-medium outline-none focus:border-accent"
          />

          <label className="flex items-center gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              checked={withContact}
              onChange={(e) => setWithContact(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              Add shop contact line <span className="text-muted-2">({SMS_CONTACT_LINE})</span>
            </span>
          </label>

          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">Preview</div>
            <div className="rounded-2xl bg-ground p-3">
              <div className="mb-1.5 text-center text-[11px] font-bold text-muted-2">{SMS_SHOP_NAME}</div>
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md bg-surface px-3.5 py-2.5 text-sm font-medium shadow-sm">
                {message.trim() ? finalText : <span className="text-muted-2">Your message will appear here</span>}
              </div>
            </div>
            <div className={`mt-1.5 flex justify-between gap-2 text-xs font-semibold ${tooLong ? "text-danger" : "text-muted"}`}>
              <span>
                {finalText.length}/{SMS_MAX_LENGTH} characters
                {unicode && " · Tamil/Sinhala uses 70 a part"}
              </span>
              <span>
                {segments} part{segments === 1 ? "" : "s"}
                {recipients ? ` · ~${segments * recipients} credits` : ""}
              </span>
            </div>
          </div>

          {notice && (
            <p
              role="status"
              className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold ${
                notice.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
              }`}
            >
              {notice.text}
            </p>
          )}

          <button
            disabled={!canSend}
            onClick={() => setConfirming(true)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-base font-bold text-white disabled:opacity-50"
          >
            <Send size={18} />
            {sending ? "Sending…" : `Send to ${recipients} · ${audienceLabel}`}
          </button>
        </div>
      </section>

      {confirming && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-surface p-5">
            <h3 className="text-xl font-extrabold">Send to {recipients} numbers?</h3>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">
              {audienceLabel} · about {segments * recipients} SMS credits. This can&apos;t be undone.
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-ground px-3.5 py-3 text-sm font-medium">
              {finalText}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="min-h-[52px] flex-1 rounded-2xl border border-border text-base font-bold text-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                className="min-h-[52px] flex-[2] rounded-2xl bg-accent text-base font-bold text-white"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
