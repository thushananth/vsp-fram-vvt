"use client";

import Link from "next/link";
import { BarChart3, ChevronRight, Contact, HandCoins, Info, Receipt, TrendingUp, CalendarClock } from "lucide-react";
import { money } from "@/lib/format";
import type { Masker } from "@/lib/assistant/mask";
import type { ToolOutcome, ScreenCard } from "@/lib/assistant/tools";
import { rangeLabel } from "@/lib/assistant/dates";
import type { Row } from "@/lib/assistant/types";

/**
 * The cards under each answer. Every figure here comes from the tool results
 * (worked out in code on the tablet), never from the model's text.
 */

type Card<T extends ScreenCard["type"]> = Extract<ScreenCard, { type: T }>;

const qtyText = (n: number) => n.toLocaleString("en-LK", { maximumFractionDigits: 3 });

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-b border-border px-3.5 py-2.5">
        <b className="text-sm font-extrabold">{title}</b>
        {sub && <span className="text-xs font-semibold text-muted">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Figures({ items }: { items: { label: string; value: string; tone?: "up" | "down" }[] }) {
  return (
    <div className={`grid gap-px bg-border ${items.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
      {items.map((f) => (
        <div key={f.label} className="min-w-0 bg-surface px-3 py-2.5 sm:px-3.5">
          <small className="block text-[10.5px] font-bold uppercase tracking-wider text-muted">{f.label}</small>
          <strong
            className={`tabular-nums block truncate text-[15px] font-extrabold sm:text-[17px] ${
              f.tone === "up" ? "text-success" : f.tone === "down" ? "text-danger" : ""
            }`}
          >
            {f.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

function ListRows({ rows }: { rows: { key: string; label: React.ReactNode; sub?: string; value: string; href?: string }[] }) {
  return (
    <div>
      {rows.map((r, i) => {
        const inner = (
          <>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{r.label}</span>
              {r.sub && <span className="block truncate text-xs font-semibold text-muted">{r.sub}</span>}
            </span>
            <strong className="tabular-nums shrink-0 font-extrabold">{r.value}</strong>
          </>
        );
        const cls = `flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-2 text-sm ${i ? "border-t border-border" : ""}`;
        return r.href ? (
          <Link key={r.key} href={r.href} className={`${cls} hover:bg-ground`}>
            {inner}
          </Link>
        ) : (
          <div key={r.key} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/** Day bars; with a second series, paired bars (this period vs the one before). */
function DayBars({ days, compare }: { days: { day: string; total: number }[]; compare?: { day: string; total: number }[] }) {
  const all = [...days.map((d) => d.total), ...(compare ?? []).map((d) => d.total)];
  const max = Math.max(1, ...all);
  const weekday = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
  const label = (key: string) => (days.length <= 7 ? weekday(key) : String(new Date(`${key}T12:00:00`).getDate()));
  return (
    <div className="px-3.5 pb-3 pt-3">
      <div className="flex h-[92px] items-end gap-1.5" aria-hidden>
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end gap-0.5">
            {compare && (
              <i className="block flex-1 rounded-t bg-accent/25" style={{ height: `${((compare[i]?.total ?? 0) / max) * 100}%` }} />
            )}
            <i className="block flex-1 rounded-t bg-accent" style={{ height: `${(d.total / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[11px] font-bold text-muted-2">
        {days.map((d) => (
          <span key={d.day} className="flex-1 truncate">
            {label(d.day)}
          </span>
        ))}
      </div>
      {compare && (
        <div className="mt-2 flex gap-4 text-[11.5px] font-semibold text-muted">
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-accent" />
            This period
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-accent/25" />
            Before
          </span>
        </div>
      )}
    </div>
  );
}

function SalesCard({ card }: { card: Card<"sales"> }) {
  const t = card.totals;
  return (
    <Shell title="Sales" sub={rangeLabel(card.from, card.to)}>
      <Figures
        items={[
          { label: "Net sales", value: money(t.net) },
          { label: "Bills", value: t.bills.toLocaleString("en-LK") },
          { label: "Cash in", value: money(t.cashIn) },
        ]}
      />
      {card.byDay.length > 1 && <DayBars days={card.byDay} />}
      {card.byCategory.length > 0 && (
        <div className="border-t border-border">
          <ListRows
            rows={card.byCategory.slice(0, 4).map((c) => ({
              key: c.id || c.name,
              label: c.name,
              sub: `Cash ${money(c.cash)} · Credit ${money(c.credit)}`,
              value: money(c.total),
            }))}
          />
        </div>
      )}
    </Shell>
  );
}

/** Two sales results in one answer: this period against the one before. */
function CompareCard({ a, b }: { a: Card<"sales">; b: Card<"sales"> }) {
  // The later range is "this period".
  const [now, before] = a.from >= b.from ? [a, b] : [b, a];
  const diff = Math.round((now.totals.net - before.totals.net) * 100) / 100;
  const pct = before.totals.net > 0 ? Math.round((diff / before.totals.net) * 1000) / 10 : null;
  const sameShape = now.byDay.length === before.byDay.length && now.byDay.length > 1;
  return (
    <Shell title="Net sales" sub={`${rangeLabel(now.from, now.to)} vs ${rangeLabel(before.from, before.to)}`}>
      <Figures
        items={[
          { label: "This period", value: money(now.totals.net) },
          { label: "Before", value: money(before.totals.net) },
          {
            label: pct === null ? "Change" : `Change ${pct > 0 ? "+" : ""}${pct}%`,
            value: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${money(Math.abs(diff))}`,
            tone: diff > 0 ? "up" : diff < 0 ? "down" : undefined,
          },
        ]}
      />
      {sameShape && <DayBars days={now.byDay} compare={before.byDay} />}
    </Shell>
  );
}

function ProfitCard({ card }: { card: Card<"profit"> }) {
  const t = card.totals;
  return (
    <Shell title="Profit" sub={rangeLabel(card.from, card.to)}>
      <Figures
        items={[
          { label: "Revenue", value: money(t.revenue) },
          { label: "Cost", value: money(t.cost) },
          { label: `Profit · ${card.marginPct}%`, value: money(t.profit), tone: t.profit < 0 ? "down" : undefined },
        ]}
      />
      {card.rows.length > 0 && (
        <div className="border-t border-border">
          <ListRows
            rows={card.rows.slice(0, 5).map((r) => ({
              key: r.name,
              label: r.name,
              sub: `${qtyText(r.qty)} sold · ${money(r.revenue)}${r.estimated ? " · estimated cost" : ""}`,
              value: money(r.profit),
            }))}
          />
        </div>
      )}
      {t.estimatedLines > 0 && (
        <p className="border-t border-border px-3.5 py-2 text-xs font-semibold text-muted">
          {t.estimatedLines} older line{t.estimatedLines === 1 ? "" : "s"} used today&apos;s cost price.
        </p>
      )}
    </Shell>
  );
}

const ROW_FIELDS: Partial<Record<string, string[]>> = {
  bills: ["bill", "createdAt", "customer", "total"],
  creditPayments: ["createdAt", "customer", "amount"],
  orders: ["order", "deliveryDate", "customer", "estimate"],
  customers: ["customer", "type", "balance"],
  products: ["product", "category", "price"],
  categories: ["category", "unit"],
  users: ["user", "role"],
};
const MONEY_FIELDS = new Set(["total", "amount", "estimate", "balance", "price", "paid", "due", "costPrice", "advance"]);

function show(masker: Masker, field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return field === "customer" ? "Walk-in" : "—";
  if (typeof value === "number") return MONEY_FIELDS.has(field) ? money(value) : qtyText(value);
  return masker.unmask(String(value));
}

function RowsCard({ card, masker }: { card: Card<"rows">; masker: Masker }) {
  if (!card.rows.length) return null;
  const present = Object.keys(card.rows[0]);
  const preferred = (ROW_FIELDS[card.collection] ?? []).filter((f) => present.includes(f));
  const fields = (preferred.length ? preferred : present).slice(0, 4);
  const shown = card.rows.slice(0, 8);
  const numeric = (f: string) => typeof card.rows[0][f] === "number";
  return (
    <Shell title={`${card.total.toLocaleString("en-LK")} ${card.total === 1 ? "record" : "records"}`} sub={card.collection}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {shown.map((r: Row, i) => (
              <tr key={i} className={i ? "border-t border-border" : ""}>
                {fields.map((f) => (
                  <td key={f} className={`whitespace-nowrap px-3.5 py-2 ${numeric(f) ? "tabular-nums text-right font-extrabold" : "font-semibold"}`}>
                    {show(masker, f, r[f])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.total > shown.length && (
        <p className="border-t border-border px-3.5 py-2 text-xs font-semibold text-muted">
          Showing {shown.length} of {card.total.toLocaleString("en-LK")}
        </p>
      )}
    </Shell>
  );
}

function AggregateCard({ card, masker }: { card: Card<"aggregate">; masker: Masker }) {
  const { result, sum } = card;
  const first = sum[0];
  const value = (sums: Record<string, number>, count: number) =>
    first ? (first === "qty" ? qtyText(sums[first]) : money(sums[first])) : count.toLocaleString("en-LK");
  if (!card.groupBy || !result.groups) {
    const items = [
      ...sum.slice(0, 2).map((f) => ({ label: f, value: f === "qty" ? qtyText(result.sums[f]) : money(result.sums[f]) })),
      { label: "Count", value: result.count.toLocaleString("en-LK") },
    ];
    return (
      <Shell title="Totals" sub={card.collection}>
        <Figures items={items} />
      </Shell>
    );
  }
  return (
    <Shell title={`By ${card.groupBy}`} sub={`${card.collection}${first ? ` · ${first}` : ""}`}>
      <ListRows
        rows={result.groups.slice(0, 8).map((g, i) => ({
          key: `${i}`,
          label: show(masker, card.groupBy!, g.key),
          sub: `${g.count.toLocaleString("en-LK")} ${g.count === 1 ? "record" : "records"}`,
          value: value(g.sums, g.count),
        }))}
      />
    </Shell>
  );
}

function PeopleCard({ card }: { card: Card<"people"> }) {
  if (!card.matches.length) return null;
  return (
    <Shell title={card.kind === "staff" ? "Staff" : "Customers"} sub={`${card.matches.length} found`}>
      <ListRows rows={card.matches.map((m) => ({ key: m.code, label: m.name, value: "", sub: m.detail }))} />
    </Shell>
  );
}

function AccountCard({ card }: { card: Card<"account"> }) {
  return (
    <Shell title={card.name} sub="Credit account">
      <Figures
        items={[
          { label: "Owes", value: money(card.balance) },
          { label: "Advance held", value: money(card.advance) },
          { label: "Bills owing", value: String(card.owing.length) },
        ]}
      />
      {card.owing.length > 0 && (
        <div className="border-t border-border">
          <ListRows
            rows={card.owing.slice(0, 5).map((b) => ({
              key: b.id,
              label: b.label,
              sub: `${b.date} · total ${money(b.total)}`,
              value: money(b.due),
            }))}
          />
        </div>
      )}
    </Shell>
  );
}

const STRIPE = { high: "bg-warning", medium: "bg-warning/45", low: "bg-border" } as const;
const TAG: Record<string, string> = {
  change: "Change",
  "same-amount": "Same amount",
  pair: "Pair",
  triple: "Three bills",
  void: "Voided",
  "part-credit": "Part-paid",
  "price-override": "Price changed",
  "round-off": "Round-off",
  "large-change": "Large change",
  duplicate: "Twice?",
  "not-on-server": "Not sent",
};

function CashCard({ card }: { card: Card<"cash"> }) {
  const { result } = card;
  const e = result.expected;
  return (
    <div className="flex flex-col gap-2.5">
      <Shell title={`Expected cash · ${card.cashierName}`} sub={`${rangeLabel(result.day, result.day)} · bills + cash payments`}>
        <Figures
          items={[
            { label: "Bills paid", value: money(e.billsPaid) },
            { label: "Payments", value: money(e.payments) },
            { label: "Expected", value: money(e.total) },
          ]}
        />
        <p className="border-t border-border px-3.5 py-2 text-xs font-semibold text-muted">
          {e.bills} bills · {e.cashPayments} cash payments
          {e.voids > 0 && ` · ${e.voids} voided (${money(e.voidPaid)} handed back, not counted)`}
        </p>
      </Shell>
      {result.candidates.length > 0 ? (
        <>
          <h3 className="px-0.5 pt-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-2">Bills to check</h3>
          {result.candidates.map((c, i) => (
            <Link
              key={`${c.kind}-${i}`}
              href="/bills"
              className="flex min-h-[64px] items-stretch rounded-2xl border border-border bg-surface hover:bg-ground"
            >
              <span className={`w-1.5 shrink-0 rounded-l-2xl ${STRIPE[c.strength]}`} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="tabular-nums text-[13px] font-bold text-muted">
                    {c.bills.map((b) => b.label).join(" + ")} · {c.bills.map((b) => b.time).join(", ")}
                  </span>
                  <span
                    className={`rounded-full px-2 py-px text-[11px] font-bold ${
                      c.strength === "low" ? "bg-ground text-muted" : "bg-warning/10 text-warning"
                    }`}
                  >
                    {TAG[c.kind] ?? c.kind}
                  </span>
                  <span className="tabular-nums ml-auto text-base font-extrabold">{money(c.bills.reduce((s, b) => s + b.amount, 0))}</span>
                </span>
                <span className="text-[13px] font-medium">{c.reason}</span>
              </span>
              <span className="flex items-center px-2.5 text-muted-2">
                <ChevronRight size={18} strokeWidth={2.4} />
              </span>
            </Link>
          ))}
          {result.morePairs > 0 && (
            <p className="px-0.5 text-xs font-semibold text-muted">{result.morePairs} more pairs of bills also add up to it.</p>
          )}
        </>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm font-medium text-muted">
          No bill stands out. Count the drawer again, and check any bills still on another tablet.
        </p>
      )}
      <p className="flex items-start gap-2 px-0.5 text-[12.5px] font-medium text-muted">
        <Info size={15} className="mt-0.5 shrink-0" />
        These are bills to check, not proof of a mistake. Open Bills to see a bill&apos;s lines and receipt.
      </p>
    </div>
  );
}

/** Which cards to show for one answer, and the screens they link to. */
export function AnswerCards({ outcomes, masker }: { outcomes: ToolOutcome[]; masker: Masker }) {
  const cards = outcomes.filter((o) => o.ok && o.forScreen).map((o) => o.forScreen!);
  const others = cards.filter((c) => c.type !== "people");
  // A name lookup is only interesting when nothing else came of it (several matches).
  const visible = others.length ? others : cards;
  const sales = visible.filter((c): c is Card<"sales"> => c.type === "sales");
  const compare = sales.length === 2 ? sales : null;

  const links = new Map<string, { href: string; label: string; icon: React.ReactNode }>();
  for (const c of visible) {
    if (c.type === "sales") links.set(`r${c.from}${c.to}`, { href: "/report", label: `Report · ${rangeLabel(c.from, c.to)}`, icon: <BarChart3 size={13} /> });
    if (c.type === "profit") links.set("profit", { href: "/profit", label: "Profit", icon: <TrendingUp size={13} /> });
    if (c.type === "account") links.set(`a${c.customerId}`, { href: `/report/customer?id=${encodeURIComponent(c.customerId)}&range=thisMonth`, label: c.name, icon: <Contact size={13} /> });
    if (c.type === "cash") links.set("bills", { href: "/bills", label: "Bills", icon: <Receipt size={13} /> });
    if ((c.type === "rows" || c.type === "aggregate") && c.collection === "orders") links.set("orders", { href: "/orders", label: "Orders", icon: <CalendarClock size={13} /> });
    if ((c.type === "rows" || c.type === "aggregate") && (c.collection === "customers" || c.collection === "creditPayments")) {
      links.set("credit", { href: "/credit", label: "Credit", icon: <HandCoins size={13} /> });
    }
  }

  return (
    <>
      {compare && <CompareCard a={compare[0]} b={compare[1]} />}
      {visible.map((c, i) => {
        if (c.type === "sales") return compare ? null : <SalesCard key={i} card={c} />;
        if (c.type === "profit") return <ProfitCard key={i} card={c} />;
        if (c.type === "rows") return <RowsCard key={i} card={c} masker={masker} />;
        if (c.type === "aggregate") return <AggregateCard key={i} card={c} masker={masker} />;
        if (c.type === "people") return <PeopleCard key={i} card={c} />;
        if (c.type === "account") return <AccountCard key={i} card={c} />;
        return <CashCard key={i} card={c} />;
      })}
      {links.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[...links.entries()].map(([k, l]) => (
            <Link
              key={k}
              href={l.href}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-accent/10 px-3 text-[12.5px] font-bold text-accent"
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
