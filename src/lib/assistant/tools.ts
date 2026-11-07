import { round2, round3 } from "@/lib/billLines";
import { localDateKey } from "@/lib/format";
import { billLabel } from "@/lib/orders";
import { buildProfit } from "@/lib/profit";
import { buildSalesReport } from "@/lib/salesReport";
import type { Bill } from "@/lib/types";
import { cashCheck, type CashCheckResult, type UnsentBill } from "./cashCheck";
import { addDaysMs, dayRange, dayStartMs, MAX_RANGE_DAYS, rangeLabel, stamp } from "./dates";
import { Masker } from "./mask";
import {
  aggregate,
  applySort,
  applyWhere,
  MAX_ROWS,
  OPERATORS,
  parseConditions,
  parseFieldList,
  parseLimit,
  parseSort,
  type AggregateResult,
} from "./query";
import { Reader } from "./reader";
import {
  billLineRows,
  billRow,
  categoryRow,
  COLLECTIONS,
  customerRow,
  FIELDS,
  LINE_COLLECTIONS,
  orderLineRows,
  orderRow,
  paymentRow,
  productRow,
  RANGE_RULE,
  settingsRow,
  userRow,
  type CollectionName,
  type FieldSpec,
  type Lookups,
} from "./schema";
import { ToolInputError, TooManyRowsError, type DataSource, type Row } from "./types";

/**
 * The tools Gemini may call, and the runner that carries them out on the
 * tablet. Every tool only reads. Each call gives back two things:
 *
 * - `forModel`: what goes to Gemini, with customer and staff names as codes;
 * - `forScreen`: what the Ask screen draws its cards from, with real names
 *   and bill ids. Figures on screen come from here, never from the model's text.
 */

// ---- Declarations ---------------------------------------------------------

/** JSON-schema-like declarations in the shape firebase/ai's FunctionDeclaration takes. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Kept short on purpose: every model turn resends these, and the AI service
// allows only so many tokens a minute.
function describeFields(fields: Record<string, FieldSpec>): string {
  return Object.entries(fields)
    .map(([name, f]) => (f.values ? `${name}=${f.values.join("|")}` : f.type === "person" ? `${name}(code)` : name))
    .join(", ");
}

const collectionsHelp = COLLECTIONS.map((c) => {
  const range = RANGE_RULE[c] === "createdAt" ? " [from/to]" : RANGE_RULE[c] === "deliveryDate" ? " [from/to = delivery days]" : "";
  const lines = LINE_COLLECTIONS[c] ? `; unnest lines adds ${describeFields(LINE_COLLECTIONS[c]!)}` : "";
  return `${c}${range}: ${describeFields(FIELDS[c])}${lines}`;
}).join("\n");

const GLOSSARY =
  "bills: total=charged, paid=cash taken at till, due=still owed, discount=round-off, priceOverride=below list price, tender/change=cash handed over/given back, products=names (use contains). Dates compare as 'yyyy-mm-dd HH:mm' text.";

const whereSchema = {
  type: "array",
  description: `All must hold. op: ${OPERATORS.join(" ")}. "in" takes a comma list.`,
  items: {
    type: "object",
    properties: { field: { type: "string" }, op: { type: "string", enum: [...OPERATORS] }, value: { type: "string" } },
    required: ["field", "op", "value"],
  },
};

const day = { type: "string", description: "yyyy-mm-dd" };
const common = {
  collection: { type: "string", enum: [...COLLECTIONS] },
  from: day,
  to: day,
  unnest: { type: "string", enum: ["lines"] },
  where: whereSchema,
};

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "query",
    description: `Read rows (max ${MAX_ROWS}, default 20). For totals use aggregate. People are codes (C7 customer, U2 staff). Collections and fields:\n${collectionsHelp}\n${GLOSSARY}`,
    parameters: {
      type: "object",
      properties: {
        ...common,
        orderBy: {
          type: "object",
          properties: { field: { type: "string" }, direction: { type: "string", enum: ["asc", "desc"] } },
          required: ["field"],
        },
        limit: { type: "integer" },
        fields: { type: "array", items: { type: "string" } },
      },
      required: ["collection"],
    },
  },
  {
    name: "aggregate",
    description: "Count rows and sum number fields exactly, optionally grouped by one field (day, hour, cashier, customer, product, category...). Same collections, fields and where as query. Use for every total.",
    parameters: {
      type: "object",
      properties: { ...common, sum: { type: "array", items: { type: "string" } }, groupBy: { type: "string" } },
      required: ["collection"],
    },
  },
  {
    name: "sales_summary",
    description: "Sales as the Report screen shows them: net, cash, credit, bills, round-off, voids, credit payments received, cash in; by category, product and day.",
    parameters: {
      type: "object",
      properties: {
        from: day,
        to: day,
        cashier: { type: "string", description: "U code" },
        paymentType: { type: "string", enum: ["cash", "credit"] },
        kind: { type: "string", enum: ["till", "order"] },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "profit_summary",
    description: "Profit as the Profit screen shows it: revenue, cost, profit, margin, by product.",
    parameters: { type: "object", properties: { from: day, to: day }, required: ["from", "to"] },
  },
  {
    name: "find_person",
    description: "Find a customer or staff member by typed name. Returns codes for other tools.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, kind: { type: "string", enum: ["customer", "staff"] } },
      required: ["name", "kind"],
    },
  },
  {
    name: "customer_account",
    description: "A customer's credit account: balance, advance, bills owing, last bill and payment, last 30 days.",
    parameters: { type: "object", properties: { customer: { type: "string", description: "C code" } }, required: ["customer"] },
  },
  {
    name: "cash_check",
    description: "A cashier is short at day end: expected cash (non-void bills paid + cash payments received; no float; voids refunded) and ranked bills to check with reasons.",
    parameters: {
      type: "object",
      properties: {
        date: day,
        cashier: { type: "string", description: "U code or typed name" },
        shortBy: { type: "number", description: "Rs missing" },
      },
      required: ["date", "cashier", "shortBy"],
    },
  },
];

// ---- Results ----------------------------------------------------------------

export type ScreenCard =
  | { type: "rows"; collection: CollectionName; rows: Row[]; total: number }
  | { type: "aggregate"; collection: CollectionName; groupBy: string | null; sum: string[]; result: AggregateResult }
  | {
      type: "sales";
      from: string;
      to: string;
      totals: ReturnType<typeof buildSalesReport>["totals"];
      byDay: ReturnType<typeof buildSalesReport>["byDay"];
      byCategory: ReturnType<typeof buildSalesReport>["byCategory"];
      byProduct: ReturnType<typeof buildSalesReport>["byProduct"];
    }
  | {
      type: "profit";
      from: string;
      to: string;
      totals: ReturnType<typeof buildProfit>["totals"];
      marginPct: number;
      rows: { name: string; qty: number; revenue: number; cost: number; profit: number; estimated: boolean }[];
    }
  | { type: "people"; kind: "customer" | "staff"; matches: { code: string; name: string; detail: string }[] }
  | {
      type: "account";
      customerId: string;
      name: string;
      balance: number;
      advance: number;
      owing: { id: string; label: string; date: string; total: number; due: number }[];
    }
  | { type: "cash"; cashierName: string; result: CashCheckResult };

export interface ToolOutcome {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** Short chip text: "Sales · 1–7 Nov". */
  label: string;
  forModel: Record<string, unknown>;
  forScreen: ScreenCard | null;
}

// ---- Runner -------------------------------------------------------------------

export interface AssistantToolsOptions {
  source: DataSource;
  /** This device's unconfirmed bills, for cash_check. */
  unsentBills?: () => UnsentBill[];
  now?: () => number;
}

export interface AssistantTools {
  declarations: ToolDeclaration[];
  masker: Masker;
  reader: Reader;
  beginQuestion(): void;
  run(name: string, args: Record<string, unknown> | undefined): Promise<ToolOutcome>;
  /** New chat: forget codes and cached reads. */
  reset(): void;
}

export const TOOL_LABEL: Record<string, string> = {
  query: "Read",
  aggregate: "Totals",
  sales_summary: "Sales",
  profit_summary: "Profit",
  find_person: "Find",
  customer_account: "Account",
  cash_check: "Cash check",
};

export function createAssistantTools(options: AssistantToolsOptions): AssistantTools {
  const masker = new Masker();
  const reader = new Reader(options.source);
  const now = options.now ?? Date.now;

  async function lookups(): Promise<Lookups> {
    const [categories, products, users] = await Promise.all([reader.categories(), reader.products(), reader.users()]);
    return {
      masker,
      categoriesById: new Map(categories.map((c) => [c.id, c])),
      productsById: new Map(products.map((p) => [p.id, p])),
      usersById: new Map(users.map((u) => [u.id, u])),
    };
  }

  function needRange(collection: CollectionName, args: Record<string, unknown>) {
    if (args.from === undefined) {
      throw new ToolInputError(`${collection} needs from and to (yyyy-mm-dd), at most ${MAX_RANGE_DAYS} days apart.`);
    }
    return dayRange(args.from, args.to);
  }

  async function rowsFor(args: Record<string, unknown>): Promise<{
    collection: CollectionName;
    fields: Record<string, FieldSpec>;
    rows: Row[];
    rangeText: string | null;
  }> {
    const collection = args.collection as CollectionName;
    if (!COLLECTIONS.includes(collection)) {
      throw new ToolInputError(`Unknown collection ${JSON.stringify(args.collection)}. Allowed: ${COLLECTIONS.join(", ")}.`);
    }
    const unnest = args.unnest === "lines";
    if (args.unnest !== undefined && args.unnest !== null && !unnest) throw new ToolInputError('unnest can only be "lines".');
    if (unnest && !LINE_COLLECTIONS[collection]) throw new ToolInputError(`${collection} has no lines to unnest.`);
    const fields = unnest ? { ...FIELDS[collection], ...LINE_COLLECTIONS[collection]! } : FIELDS[collection];
    if (unnest) delete (fields as Record<string, FieldSpec>).products;

    const l = await lookups();
    let rows: Row[];
    let rangeText: string | null = null;
    switch (collection) {
      case "bills": {
        const r = needRange(collection, args);
        rangeText = rangeLabel(r.from, r.to);
        const bills = await reader.bills(r);
        rows = unnest ? bills.flatMap((b) => billLineRows(b, l)) : bills.map((b) => billRow(b, l));
        break;
      }
      case "creditPayments": {
        const r = needRange(collection, args);
        rangeText = rangeLabel(r.from, r.to);
        rows = (await reader.creditPayments(r)).map((p) => paymentRow(p, l));
        break;
      }
      case "orders": {
        const r = needRange(collection, args);
        rangeText = rangeLabel(r.from, r.to);
        const orders = await reader.orders(r.from, r.to);
        rows = unnest ? orders.flatMap((o) => orderLineRows(o, l)) : orders.map((o) => orderRow(o, l));
        break;
      }
      case "customers":
        rows = (await reader.customers()).map((c) => customerRow(c, l));
        break;
      case "products":
        rows = (await reader.products()).map(productRow);
        break;
      case "categories":
        rows = (await reader.categories()).map(categoryRow);
        break;
      case "users":
        rows = (await reader.users()).map((u) => userRow(u, l));
        break;
      case "settings":
        rows = [settingsRow(await reader.storeFacts())];
        break;
    }
    return { collection, fields, rows, rangeText };
  }

  async function runQuery(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const { collection, fields, rows, rangeText } = await rowsFor(args);
    const where = parseConditions(args.where, fields);
    const sort = parseSort(args.orderBy, fields);
    const limit = parseLimit(args.limit);
    const pick = parseFieldList(args.fields, fields, "fields");
    const matched = applySort(applyWhere(rows, where), sort);
    const page = matched.slice(0, limit).map((r) => (pick.length ? Object.fromEntries(pick.map((f) => [f, r[f]])) : r));
    return {
      label: `${collection}${rangeText ? ` · ${rangeText}` : ""} · ${matched.length} rows`,
      forModel: {
        rows: page,
        matched: matched.length,
        ...(matched.length > page.length ? { note: `Showing ${page.length} of ${matched.length}. Use aggregate for totals.` } : {}),
      },
      forScreen: { type: "rows", collection, rows: page, total: matched.length },
    };
  }

  async function runAggregate(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const { collection, fields, rows, rangeText } = await rowsFor(args);
    const where = parseConditions(args.where, fields);
    const sum = parseFieldList(args.sum, fields, "sum", true);
    let groupBy: string | null = null;
    if (args.groupBy !== undefined && args.groupBy !== null && args.groupBy !== "") {
      groupBy = parseFieldList([args.groupBy], fields, "groupBy")[0];
    }
    const result = aggregate(applyWhere(rows, where), sum, groupBy);
    return {
      label: `Totals · ${collection}${rangeText ? ` · ${rangeText}` : ""}${groupBy ? ` · by ${groupBy}` : ""}`,
      forModel: { ...result },
      forScreen: { type: "aggregate", collection, groupBy, sum, result },
    };
  }

  function userId(code: unknown, field: string): string {
    const id = masker.idOf(code, "U");
    if (!id) throw new ToolInputError(`${field} ${JSON.stringify(code)} is not a staff code from this chat. Call find_person first.`);
    return id;
  }

  async function runSales(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const r = dayRange(args.from, args.to);
    const cashierId = args.cashier ? userId(args.cashier, "cashier") : null;
    const [bills, payments, products, categories] = await Promise.all([
      reader.bills(r),
      reader.creditPayments(r),
      reader.products(),
      reader.categories(),
    ]);
    const keep = (b: Bill) =>
      (!cashierId || b.cashierId === cashierId) &&
      (!args.paymentType || b.paymentType === args.paymentType) &&
      (!args.kind || (args.kind === "order" ? b.kind === "order" : b.kind !== "order"));
    const report = buildSalesReport({
      bills: bills.filter(keep),
      payments: cashierId ? payments.filter((p) => p.receivedBy === cashierId) : payments,
      customers: [],
      products,
      categories,
      startMs: r.startMs,
      endMs: r.endMs,
    });
    const t = report.totals;
    return {
      label: `Sales · ${rangeLabel(r.from, r.to)}`,
      forModel: {
        from: r.from,
        to: r.to,
        totals: {
          netSales: t.net,
          cashSales: t.cash,
          creditSales: t.credit,
          bills: t.bills,
          averageBill: t.bills ? round2(t.net / t.bills) : 0,
          roundOff: t.roundOff,
          priceOverrides: t.priceDiscount,
          voidBills: t.voidBills,
          voidedAmount: t.voided,
          creditPaymentsReceived: t.received,
          cashTakenIn: t.cashIn,
        },
        byCategory: report.byCategory.map((c) => ({ category: c.name, cash: c.cash, credit: c.credit, total: c.total })),
        byProduct: report.byProduct.slice(0, 12).map((p) => ({ product: p.name, unit: p.unit, qty: p.qty, total: p.total })),
        ...(report.byProduct.length > 12 ? { moreProducts: report.byProduct.length - 12 } : {}),
        byDay: report.byDay.map((d) => ({ day: d.day, bills: d.bills, total: d.total, cash: d.cash, credit: d.credit, received: d.received })),
      },
      forScreen: {
        type: "sales",
        from: r.from,
        to: r.to,
        totals: t,
        byDay: report.byDay,
        byCategory: report.byCategory,
        byProduct: report.byProduct,
      },
    };
  }

  async function runProfit(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const r = dayRange(args.from, args.to);
    const [bills, products] = await Promise.all([reader.bills(r), reader.products()]);
    const { rows, totals } = buildProfit({
      bills,
      productsById: new Map(products.map((p) => [p.id, p])),
      startMs: r.startMs,
      endMs: r.endMs,
    });
    const marginPct = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : 0;
    const slim = rows.map((x) => ({
      name: x.name,
      qty: round3(x.qty),
      revenue: round2(x.revenue),
      cost: round2(x.cost),
      profit: round2(x.profit),
      estimated: x.estimated,
    }));
    const losing = slim.filter((x) => x.profit < 0);
    return {
      label: `Profit · ${rangeLabel(r.from, r.to)}`,
      forModel: {
        from: r.from,
        to: r.to,
        totals: {
          revenue: round2(totals.revenue),
          cost: round2(totals.cost),
          profit: round2(totals.profit),
          marginPct,
          bills: totals.bills,
          estimatedLines: totals.estimatedLines,
        },
        byProduct: slim.slice(0, 12).map(({ name, ...rest }) => ({ product: name, ...rest })),
        ...(slim.length > 12 ? { moreProducts: slim.length - 12 } : {}),
        sellingBelowCost: losing.map((x) => x.name),
      },
      forScreen: { type: "profit", from: r.from, to: r.to, totals, marginPct, rows: slim },
    };
  }

  async function findPerson(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const name = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
    if (name.length < 2) throw new ToolInputError("name needs at least 2 letters.");
    const kind = args.kind === "staff" ? "staff" : args.kind === "customer" ? "customer" : null;
    if (!kind) throw new ToolInputError('kind is "customer" or "staff".');
    const words = name.split(/\s+/);
    const score = (candidate: string) => {
      const c = candidate.toLowerCase();
      if (c === name) return 3;
      if (c.startsWith(name)) return 2;
      return words.every((w) => c.includes(w)) ? 1 : 0;
    };
    const l = await lookups();
    if (kind === "staff") {
      const users = await reader.users();
      const hits = users
        .map((u) => ({ u, s: score(u.name) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || Number(b.u.active) - Number(a.u.active))
        .slice(0, 8);
      const matches = hits.map(({ u }) => ({ code: masker.code("U", u.id, u.name), name: u.name, detail: u.active ? u.role : `${u.role}, switched off` }));
      return {
        label: `Find · ${matches.length} staff`,
        forModel: { matches: hits.map(({ u }, i) => ({ code: matches[i].code, role: u.role, active: u.active })) },
        forScreen: { type: "people", kind, matches },
      };
    }
    const customers = await reader.customers();
    const hits = customers
      .map((c) => ({ c, s: score(c.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || Number(b.c.active) - Number(a.c.active) || b.c.remainingCredit - a.c.remainingCredit)
      .slice(0, 8);
    const matches = hits.map(({ c }) => ({
      code: l.masker.code("C", c.id, c.name),
      name: c.name,
      detail: `${c.type}${c.remainingCredit > 0 ? ` · owes Rs ${c.remainingCredit.toLocaleString("en-LK")}` : ""}`,
    }));
    return {
      label: `Find · ${matches.length} customer${matches.length === 1 ? "" : "s"}`,
      forModel: {
        matches: hits.map(({ c }, i) => ({ code: matches[i].code, type: c.type, active: c.active, balance: c.remainingCredit })),
      },
      forScreen: { type: "people", kind, matches },
    };
  }

  async function customerAccount(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const id = masker.idOf(args.customer, "C");
    if (!id) throw new ToolInputError(`customer ${JSON.stringify(args.customer)} is not a customer code from this chat. Call find_person first.`);
    const [customers, bills, payments] = await Promise.all([
      reader.customers(),
      reader.billsForCustomer(id),
      reader.paymentsForCustomer(id),
    ]);
    const c = customers.find((x) => x.id === id);
    if (!c) throw new ToolInputError("That customer no longer exists.");
    const live = bills.filter((b) => b.status !== "void").sort((a, b) => a.createdAt - b.createdAt);
    const owing = live.filter((b) => b.due > 0.004);
    const last = live[live.length - 1];
    const lastPay = payments.filter((p) => p.method !== "advance").sort((a, b) => b.createdAt - a.createdAt)[0];
    const since = addDaysMs(dayStartMs(localDateKey(now())), -30);
    const recent = live.filter((b) => b.createdAt >= since);
    const code = masker.code("C", c.id, c.name);
    const owingRows = owing.map((b) => ({ id: b.id, label: billLabel(b), date: stamp(b.createdAt) ?? "", total: b.total, due: b.due }));
    return {
      label: `Account · ${code}`,
      forModel: {
        customer: code,
        type: c.type,
        balance: c.remainingCredit,
        openingBalance: c.openingBalance,
        advance: c.advance,
        billsOwing: owingRows.slice(0, 40).map((b) => ({ bill: b.label, date: b.date, total: b.total, due: b.due })),
        ...(owingRows.length > 40 ? { moreBillsOwing: owingRows.length - 40 } : {}),
        lastBill: last ? { bill: billLabel(last), date: stamp(last.createdAt), total: last.total } : null,
        lastPayment: lastPay ? { date: stamp(lastPay.createdAt), amount: lastPay.amount } : null,
        last30Days: { bills: recent.length, total: round2(recent.reduce((s, b) => s + b.total, 0)) },
      },
      forScreen: { type: "account", customerId: c.id, name: c.name, balance: c.remainingCredit, advance: c.advance, owing: owingRows },
    };
  }

  async function runCashCheck(args: Record<string, unknown>): Promise<Omit<ToolOutcome, "name" | "args" | "ok">> {
    const r = dayRange(args.date, args.date);
    const shortBy = Number(args.shortBy);
    if (!Number.isFinite(shortBy) || shortBy === 0) throw new ToolInputError("shortBy must be the missing amount in Rs, e.g. 2500.");
    let cashierId = masker.idOf(args.cashier, "U");
    if (!cashierId) {
      // Gemini may pass the name as typed; take it when it names one person.
      const typed = typeof args.cashier === "string" ? args.cashier.trim().toLowerCase() : "";
      const users = await reader.users();
      const hits = typed.length >= 2 ? users.filter((u) => u.name.toLowerCase().includes(typed)) : [];
      if (hits.length !== 1) {
        throw new ToolInputError(
          hits.length
            ? `${hits.length} staff match ${JSON.stringify(args.cashier)}. Call find_person and ask the admin which one.`
            : `No staff member matches ${JSON.stringify(args.cashier)}. Call find_person with kind "staff".`,
        );
      }
      cashierId = hits[0].id;
    }
    const l = await lookups();
    const cashierName = l.usersById.get(cashierId)?.name ?? "Unknown user";
    const code = masker.code("U", cashierId, cashierName);
    const [bills, payments] = await Promise.all([reader.bills(r), reader.creditPayments(r)]);
    const result = cashCheck({
      day: r.from,
      cashierId,
      shortBy,
      bills,
      payments,
      unsent: options.unsentBills?.(),
    });
    return {
      label: `Cash check · ${rangeLabel(r.from, r.to)} · ${code} · Rs ${Math.abs(shortBy).toLocaleString("en-LK")}`,
      forModel: {
        date: result.day,
        cashier: code,
        shortBy: result.shortBy,
        expectedCash: result.expected,
        billsToCheck: result.candidates.map((c) => ({
          bills: c.bills.map((b) => `${b.label} ${b.time}`),
          amount: c.amount,
          likelihood: c.strength,
          reason: c.reason,
        })),
        ...(result.morePairs ? { morePairsNotListed: result.morePairs } : {}),
        note: "Bills to check, not proof of a mistake.",
      },
      forScreen: { type: "cash", cashierName, result },
    };
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<Omit<ToolOutcome, "name" | "args" | "ok">>> = {
    query: runQuery,
    aggregate: runAggregate,
    sales_summary: runSales,
    profit_summary: runProfit,
    find_person: findPerson,
    customer_account: customerAccount,
    cash_check: runCashCheck,
  };

  return {
    declarations: TOOL_DECLARATIONS,
    masker,
    reader,
    beginQuestion: () => reader.beginQuestion(),
    reset() {
      masker.clear();
      reader.clear();
    },
    async run(name, rawArgs) {
      const args = rawArgs ?? {};
      const handler = handlers[name];
      if (!handler) {
        return {
          name,
          args,
          ok: false,
          label: name,
          forModel: { error: `There is no tool called ${name}. Tools: ${Object.keys(handlers).join(", ")}.` },
          forScreen: null,
        };
      }
      try {
        return { name, args, ok: true, ...(await handler(args)) };
      } catch (err) {
        const known = err instanceof ToolInputError || err instanceof TooManyRowsError;
        return {
          name,
          args,
          ok: false,
          label: TOOL_LABEL[name] ?? name,
          forModel: {
            error: known ? (err as Error).message : "Reading the data failed. Say the data couldn't be read right now.",
          },
          forScreen: null,
        };
      }
    },
  };
}
