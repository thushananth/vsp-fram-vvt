import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cashCheck } from "../../src/lib/assistant/cashCheck";
import { dayRange } from "../../src/lib/assistant/dates";
import { Masker } from "../../src/lib/assistant/mask";
import { createAssistantTools, type ScreenCard } from "../../src/lib/assistant/tools";
import { buildProfit } from "../../src/lib/profit";
import { buildSalesReport } from "../../src/lib/salesReport";
import {
  at,
  bill,
  categories,
  customers,
  DAY,
  karthiDay,
  karthiPayments,
  memorySource,
  orders,
  products,
  users,
} from "./fixtures";

const range = dayRange(DAY, DAY);

function setup(extraBills = karthiDay()) {
  const source = memorySource({ bills: extraBills, payments: karthiPayments() });
  const tools = createAssistantTools({ source, now: () => at(DAY, "19:00") });
  tools.beginQuestion();
  return { source, tools };
}

function report(bills = karthiDay()) {
  return buildSalesReport({
    bills,
    payments: karthiPayments(),
    customers: [],
    products,
    categories,
    startMs: range.startMs,
    endMs: range.endMs,
  });
}

describe("dates and timezone", () => {
  it("runs in Sri Lanka time", () => {
    assert.equal(new Date(at(DAY, "00:30")).getTimezoneOffset(), -330, "run the tests with TZ=Asia/Colombo");
  });
  it("refuses ranges over 62 days and bad days", () => {
    assert.throws(() => dayRange("2026-09-01", "2026-11-07"), /at most 62 days/i);
    assert.throws(() => dayRange("2026-02-30", "2026-03-01"), /not a real calendar day/);
    assert.throws(() => dayRange("7/11/2026", "2026-11-07"), /yyyy-mm-dd/);
    assert.equal(dayRange("2026-09-07", "2026-11-07").to, "2026-11-07");
  });
});

describe("aggregate matches the Report screen", () => {
  it("net, cash, credit and round-off", async () => {
    const { tools } = setup();
    const expected = report().totals;
    const where = (field: string, value: string) => ({ field, op: "==", value });

    const all = await tools.run("aggregate", { collection: "bills", from: DAY, to: DAY, where: [where("status", "paid")], sum: ["total", "discount", "paid"] });
    assert.equal(all.ok, true, JSON.stringify(all.forModel));
    const sums = (all.forModel as { sums: Record<string, number>; count: number });
    assert.equal(sums.sums.total, expected.net);
    assert.equal(sums.sums.discount, expected.roundOff);
    assert.equal(sums.count, expected.bills);
    assert.equal(sums.sums.paid + expected.received, expected.cashIn);

    const byType = await tools.run("aggregate", { collection: "bills", from: DAY, to: DAY, where: [where("status", "paid")], sum: ["total"], groupBy: "paymentType" });
    const groups = (byType.forModel as { groups: { key: string; sums: { total: number } }[] }).groups;
    assert.equal(groups.find((g) => g.key === "cash")!.sums.total, expected.cash);
    assert.equal(groups.find((g) => g.key === "credit")!.sums.total, expected.credit);
  });

  it("by category through unnested lines, including amount-entered lines", async () => {
    const { tools } = setup();
    const res = await tools.run("aggregate", {
      collection: "bills", from: DAY, to: DAY, unnest: "lines",
      where: [{ field: "status", op: "==", value: "paid" }], sum: ["amount", "qty"], groupBy: "category",
    });
    const groups = (res.forModel as { groups: { key: string; sums: { amount: number } }[] }).groups;
    for (const c of report().byCategory) {
      assert.equal(groups.find((g) => g.key === c.name)!.sums.amount, c.total, c.name);
    }
  });

  it("counts a legacy bill (no paid / paymentType) as a fully paid cash sale", () => {
    const legacy = karthiDay().find((b) => b.id === "bill-legacy")!;
    assert.equal(legacy.paymentType, "cash");
    assert.equal(legacy.paid, 700);
  });
});

describe("sales_summary and profit_summary", () => {
  it("sales_summary gives the Report screen's totals", async () => {
    const { tools } = setup();
    const res = await tools.run("sales_summary", { from: DAY, to: DAY });
    assert.equal(res.ok, true, JSON.stringify(res.forModel));
    const t = report().totals;
    const m = res.forModel.totals as Record<string, number>;
    assert.equal(m.netSales, t.net);
    assert.equal(m.cashSales, t.cash);
    assert.equal(m.creditSales, t.credit);
    assert.equal(m.creditPaymentsReceived, t.received);
    assert.equal(m.cashTakenIn, t.cashIn);
    assert.equal(m.voidBills, 1);
    assert.equal((res.forScreen as Extract<ScreenCard, { type: "sales" }>).totals.net, t.net);
  });

  it("sales_summary filters by cashier code", async () => {
    const { tools } = setup();
    const found = await tools.run("find_person", { name: "ramesh", kind: "staff" });
    const code = (found.forModel.matches as { code: string }[])[0].code;
    const res = await tools.run("sales_summary", { from: DAY, to: DAY, cashier: code });
    assert.equal((res.forModel.totals as Record<string, number>).netSales, 4750);
    assert.equal((res.forModel.totals as Record<string, number>).creditPaymentsReceived, 900);
  });

  it("profit_summary gives the Profit screen's totals", async () => {
    const { tools } = setup();
    const res = await tools.run("profit_summary", { from: DAY, to: DAY });
    const expected = buildProfit({ bills: karthiDay(), productsById: new Map(products.map((p) => [p.id, p])), startMs: range.startMs, endMs: range.endMs }).totals;
    const m = res.forModel.totals as Record<string, number>;
    assert.equal(m.revenue, Math.round(expected.revenue * 100) / 100);
    assert.equal(m.profit, Math.round(expected.profit * 100) / 100);
  });
});

describe("cash_check", () => {
  const result = () =>
    cashCheck({ day: DAY, cashierId: "uid-karthi", shortBy: 2500, bills: karthiDay(), payments: karthiPayments() });

  it("works out expected cash: non-void bills paid plus cash payments, no voids, no advance", () => {
    const r = result();
    const live = karthiDay().filter((b) => b.cashierId === "uid-karthi" && b.status !== "void");
    const billsPaid = live.reduce((s, b) => s + b.paid, 0);
    assert.equal(r.expected.billsPaid, billsPaid);
    assert.equal(r.expected.payments, 6500); // 5000 + 1500; the advance spend and Ramesh's payment are out
    assert.equal(r.expected.total, billsPaid + 6500);
    assert.equal(r.expected.voids, 1);
  });

  it("puts the change mistake, the Rs 2,500 bill and the matching void at the top", () => {
    const top = result().candidates.filter((c) => c.strength === "high");
    const labels = top.map((c) => `${c.kind}:${c.bills.map((b) => b.label).join("+")}`);
    assert.ok(labels.includes("change:#1060"), labels.join(", "));
    assert.ok(labels.includes("same-amount:#1042"), labels.join(", "));
    assert.ok(labels.includes("void:#1033"), labels.join(", "));
    assert.equal(top.find((c) => c.kind === "change")!.amount, 2500);
  });

  it("finds the pair that adds up to the shortage", () => {
    const pair = result().candidates.find((c) => c.kind === "pair");
    assert.ok(pair, "no pair found");
    assert.deepEqual(pair.bills.map((b) => b.label), ["#1051", "#1057"]);
  });

  it("ignores other cashiers' bills", () => {
    assert.ok(!result().candidates.some((c) => c.bills.some((b) => b.label === "#1080")));
  });

  it("flags a duplicate and an unsent bill from this tablet", () => {
    const day = karthiDay();
    const twin = day.find((b) => b.no === 1051)!;
    day.push({ ...twin, id: "bill-dup", no: 1052, createdAt: twin.createdAt + 3 * 60_000 });
    const r = cashCheck({
      day: DAY, cashierId: "uid-karthi", shortBy: 2500, bills: day, payments: [],
      unsent: [{ id: "bill-q", no: 1099, createdAt: at(DAY, "18:30"), cashierId: "uid-karthi", total: 2500, paid: 2500, state: "pending" }],
    });
    assert.ok(r.candidates.some((c) => c.kind === "duplicate"));
    assert.ok(r.candidates.some((c) => c.kind === "not-on-server" && c.strength === "high"));
  });

  it("the tool takes a typed name and refuses an ambiguous or unknown one", async () => {
    const { tools } = setup();
    const ok = await tools.run("cash_check", { date: DAY, cashier: "Karthi", shortBy: 2500 });
    assert.equal(ok.ok, true, JSON.stringify(ok.forModel));
    assert.equal((ok.forScreen as Extract<ScreenCard, { type: "cash" }>).cashierName, "Karthi");
    const none = await tools.run("cash_check", { date: DAY, cashier: "Saman", shortBy: 2500 });
    assert.equal(none.ok, false);
    assert.match(String(none.forModel.error), /find_person/);
  });
});

describe("masking and privacy", () => {
  it("no names, mobiles, emails, notes, tokens or document ids reach Gemini", async () => {
    const { tools } = setup();
    const outs = [];
    outs.push(await tools.run("query", { collection: "bills", from: DAY, to: DAY, limit: 300 }));
    outs.push(await tools.run("query", { collection: "bills", from: DAY, to: DAY, unnest: "lines", limit: 300 }));
    outs.push(await tools.run("query", { collection: "creditPayments", from: DAY, to: DAY }));
    outs.push(await tools.run("query", { collection: "orders", from: "2026-11-01", to: "2026-11-30" }));
    outs.push(await tools.run("query", { collection: "customers" }));
    outs.push(await tools.run("query", { collection: "users" }));
    outs.push(await tools.run("find_person", { name: "kumar", kind: "customer" }));
    outs.push(await tools.run("find_person", { name: "0765", kind: "customer" }));
    const code = (outs[6].forModel.matches as { code: string }[])[0].code;
    outs.push(await tools.run("customer_account", { customer: code }));
    outs.push(await tools.run("cash_check", { date: DAY, cashier: "Karthi", shortBy: 2500 }));
    outs.push(await tools.run("sales_summary", { from: DAY, to: DAY }));
    for (const o of outs) assert.equal(o.ok, true, `${o.name}: ${JSON.stringify(o.forModel)}`);

    const sent = JSON.stringify(outs.map((o) => o.forModel));
    const secrets = [
      ...customers.map((c) => c.name),
      ...customers.map((c) => c.mobileNumber),
      ...users.map((u) => u.name),
      ...users.map((u) => u.id),
      ...customers.map((c) => c.id),
      "bill-1042", "pay-1", "order-1", "secret-token-xyz", "paid by son", "Call Nimal",
    ];
    for (const s of secrets) assert.ok(!sent.includes(s), `leaked ${s}`);
    assert.match(sent, /"C\d+"/);
    assert.match(sent, /"U\d+"/);
  });

  it("keeps one code per person for the whole chat and swaps codes back", async () => {
    const { tools } = setup();
    const a = await tools.run("find_person", { name: "kumar stores", kind: "customer" });
    const b = await tools.run("query", { collection: "customers", where: [{ field: "balance", op: ">", value: "80000" }] });
    const codeA = (a.forModel.matches as { code: string }[])[0].code;
    const codeB = (b.forModel.rows as { customer: string }[])[0].customer;
    assert.equal(codeA, codeB);
    assert.equal(tools.masker.unmask(`${codeA} owes the most.`), "Kumar Stores owes the most.");
    tools.reset();
    assert.equal(tools.masker.unmask(`${codeA} owes the most.`), `${codeA} owes the most.`);
  });

  it("Masker segments mark swapped names", () => {
    const m = new Masker();
    const c = m.code("C", "x", "Lanka Bakers");
    assert.deepEqual(m.segments(`Ask ${c} today`), [{ text: "Ask " }, { text: "Lanka Bakers", code: c }, { text: " today" }]);
  });
});

describe("guardrails", () => {
  it("bills and payments need a range; orders a delivery range", async () => {
    const { tools } = setup();
    for (const collection of ["bills", "creditPayments", "orders"]) {
      const r = await tools.run("query", { collection });
      assert.equal(r.ok, false);
      assert.match(String(r.forModel.error), /needs from and to/);
    }
  });

  it("refuses unknown collections, fields, operators and over-long pages", async () => {
    const { tools } = setup();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ collection: "deviceApprovals" }, /Unknown collection/],
      [{ collection: "orderTracking" }, /Unknown collection/],
      [{ collection: "customers", where: [{ field: "mobileNumber", op: "==", value: "077" }] }, /Unknown field/],
      [{ collection: "customers", where: [{ field: "balance", op: "LIKE", value: "1" }] }, /Unknown operator/],
      [{ collection: "customers", limit: 301 }, /at most 300/],
      [{ collection: "bills", from: "2026-01-01", to: "2026-11-07" }, /at most 62 days/i],
      [{ collection: "customers", unnest: "lines" }, /no lines/],
    ];
    for (const [args, error] of cases) {
      const r = await tools.run("query", args);
      assert.equal(r.ok, false, JSON.stringify(args));
      assert.match(String(r.forModel.error), error);
    }
    const unknownTool = await tools.run("update_bill", {});
    assert.equal(unknownTool.ok, false);
  });

  it("stops a question that would read more than the budget", async () => {
    const many = Array.from({ length: 3100 }, (_, i) =>
      bill({ id: `b${i}`, no: 5000 + i, at: at(DAY, "10:00") + i * 1000, lines: [{ productId: "p-egg", name: "Egg", qty: 1, price: 50 }] }),
    );
    const { tools, source } = setup(many);
    const r = await tools.run("query", { collection: "bills", from: DAY, to: DAY });
    assert.equal(r.ok, false);
    assert.match(String(r.forModel.error), /limit of records/);
    // Only the small lookups (staff, products, categories) were read, no bills.
    assert.ok(source.reads < 20, `read ${source.reads}`);
  });

  it("parallel calls share one budget", async () => {
    const make = (day: string, n: number, offset: number) =>
      Array.from({ length: n }, (_, i) =>
        bill({ id: `${day}-${i}`, no: offset + i, at: at(day, "08:00") + i * 1000, lines: [{ productId: "p-egg", name: "Egg", qty: 1, price: 50 }] }),
      );
    const { tools, source } = setup([...make("2026-11-05", 1600, 10000), ...make("2026-11-06", 1600, 20000)]);
    const [a, b] = await Promise.all([
      tools.run("sales_summary", { from: "2026-11-05", to: "2026-11-05" }),
      tools.run("sales_summary", { from: "2026-11-06", to: "2026-11-06" }),
    ]);
    assert.equal([a, b].filter((o) => o.ok).length, 1, "both reads got the full budget");
    assert.match(String((a.ok ? b : a).forModel.error), /limit of records/);
    assert.ok(source.reads <= 3000, `read ${source.reads}`);
  });

  it("reuses reads within a chat and counts the budget per question", async () => {
    const { tools, source } = setup();
    await tools.run("aggregate", { collection: "bills", from: DAY, to: DAY, sum: ["total"] });
    const first = source.reads;
    assert.ok(first > 0);
    tools.beginQuestion();
    await tools.run("sales_summary", { from: DAY, to: DAY });
    await tools.run("aggregate", { collection: "bills", from: DAY, to: DAY, sum: ["paid"], groupBy: "cashier" });
    // Only the day's payments were new; bills, products and categories came from the cache.
    assert.equal(source.reads, first + karthiPayments().length);
    assert.equal(tools.reader.documentsRead, karthiPayments().length);
  });

  it("query filters, sorts and limits in code", async () => {
    const { tools } = setup();
    const r = await tools.run("query", {
      collection: "bills", from: DAY, to: DAY,
      where: [{ field: "paymentType", op: "==", value: "cash" }, { field: "products", op: "contains", value: "egg" }],
      orderBy: { field: "total", direction: "desc" }, limit: 2, fields: ["bill", "total"],
    });
    assert.deepEqual(r.forModel.rows, [{ bill: "#1042", total: 2500 }, { bill: "#1057", total: 1300 }]);
    assert.ok((r.forModel.matched as number) > 2);
  });

  it("orders: OR- numbers and delivery dates", async () => {
    const { tools } = setup();
    const r = await tools.run("query", { collection: "orders", from: "2026-11-08", to: "2026-11-08" });
    assert.equal((r.forModel.rows as { order: string }[])[0].order, "OR-0043");
    assert.equal(orders.length, 1);
  });
});
