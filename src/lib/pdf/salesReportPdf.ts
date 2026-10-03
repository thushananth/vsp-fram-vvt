import type { jsPDF } from "jspdf";
import { lineAmount } from "@/lib/billLines";
import { SHOP_DETAILS } from "@/lib/constants";
import { localDateKey } from "@/lib/format";
import type { SalesReport } from "@/lib/salesReport";
import type { Bill } from "@/lib/types";
import {
  BRAND,
  fileStamp,
  footers,
  letterhead,
  loadPdf,
  pdfAmount,
  pdfDateTime,
  pdfQty,
  tableStyle,
} from "@/lib/pdf/brand";

type AutoTable = Awaited<ReturnType<typeof loadPdf>>["autoTable"];

export interface Ctx {
  doc: jsPDF;
  autoTable: AutoTable;
  y: number;
  m: number;
}

const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

function ensure(c: Ctx, needed: number) {
  if (c.y + needed > c.doc.internal.pageSize.getHeight() - 18) {
    c.doc.addPage();
    c.y = 16;
  }
}

/** Section title with the brand's amber tick. */
export function section(c: Ctx, title: string, note?: string) {
  ensure(c, 22);
  c.y += 3;
  c.doc.setFillColor(...BRAND.amber).roundedRect(c.m, c.y - 4, 1.4, 5.5, 0.7, 0.7, "F");
  c.doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...BRAND.ink).text(title, c.m + 4, c.y);
  if (note) {
    c.doc
      .setFont("helvetica", "normal")
      .setFontSize(8)
      .setTextColor(...BRAND.muted)
      .text(note, c.doc.internal.pageSize.getWidth() - c.m, c.y, { align: "right" });
  }
  c.y += 4;
}

export function table(
  c: Ctx,
  head: string[],
  body: (string | number)[][],
  opts: { right?: number[]; foot?: (string | number)[]; fontSize?: number; widths?: Record<number, number> } = {},
) {
  if (body.length === 0) {
    c.doc.setFont("helvetica", "italic").setFontSize(8.5).setTextColor(...BRAND.muted).text("Nothing in this period.", c.m, c.y + 4);
    c.y += 10;
    return;
  }
  const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
  for (const i of opts.right ?? []) columnStyles[i] = { halign: "right" };
  for (const [i, w] of Object.entries(opts.widths ?? {})) columnStyles[Number(i)] = { ...columnStyles[Number(i)], cellWidth: w };
  c.autoTable(c.doc, {
    startY: c.y,
    margin: { left: c.m, right: c.m, top: 16, bottom: 18 },
    head: [head],
    body,
    foot: opts.foot ? [opts.foot] : undefined,
    ...tableStyle(opts.fontSize ?? 8.5, opts.right),
    footStyles: { fillColor: BRAND.ink, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles,
    showFoot: "lastPage",
  });
  c.y = lastY(c.doc) + 6;
}

/** Four headline figures as cards across the page. */
export function kpis(c: Ctx, cards: { label: string; value: string; accent?: boolean }[]) {
  const w = c.doc.internal.pageSize.getWidth() - c.m * 2;
  const gap = 3;
  const cw = (w - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = c.m + i * (cw + gap);
    if (card.accent) c.doc.setFillColor(...BRAND.ink);
    else c.doc.setFillColor(...BRAND.zebra);
    c.doc.roundedRect(x, c.y, cw, 17, 2.5, 2.5, "F");
    c.doc
      .setFont("helvetica", "bold")
      .setFontSize(6.8)
      .setTextColor(...(card.accent ? BRAND.amberSoft : BRAND.muted))
      .text(card.label.toUpperCase(), x + 3.5, c.y + 5.5);
    c.doc
      .setFontSize(12.5)
      .setTextColor(...(card.accent ? ([255, 255, 255] as [number, number, number]) : BRAND.ink))
      .text(card.value, x + 3.5, c.y + 13);
  });
  c.y += 22;
}

function rs(n: number) {
  return `Rs ${pdfAmount(n)}`;
}

function headlineCards(report: SalesReport) {
  const t = report.totals;
  return [
    { label: "Net sales", value: rs(t.net), accent: true },
    { label: "Cash sales", value: rs(t.cash) },
    { label: "Credit sales", value: rs(t.credit) },
    { label: "Received from debtors", value: rs(t.received) },
  ];
}

function secondaryCards(report: SalesReport) {
  const t = report.totals;
  return [
    { label: "Bills", value: String(t.bills) },
    { label: "Cash taken in", value: rs(t.cashIn) },
    { label: "Round-off given", value: rs(t.roundOff) },
    { label: `Deleted (${t.voidBills})`, value: rs(t.voided) },
  ];
}

/** The old app's "Sales Report" / "Daily Sales Report", redrawn in the brand. */
export async function downloadSummaryPdf(report: SalesReport, label: string): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const c: Ctx = { doc, autoTable, m: 14, y: 0 };
  c.y = letterhead(doc, "Sales summary", label);
  const multiDay = report.byDay.length > 1;

  kpis(c, headlineCards(report));
  kpis(c, secondaryCards(report));

  section(c, "Summary by category");
  table(
    c,
    ["Category", "Cash", "Credit", "Total"],
    report.byCategory.map((r) => [r.name, pdfAmount(r.cash), pdfAmount(r.credit), pdfAmount(r.total)]),
    {
      right: [1, 2, 3],
      foot: [
        "Total",
        pdfAmount(report.byCategory.reduce((s, r) => s + r.cash, 0)),
        pdfAmount(report.byCategory.reduce((s, r) => s + r.credit, 0)),
        pdfAmount(report.byCategory.reduce((s, r) => s + r.total, 0)),
      ],
    },
  );

  section(c, "Summary by product", "quantities in each product's unit");
  table(
    c,
    ["Product", "Category", "Cash qty", "Cash", "Credit qty", "Credit", "Total"],
    report.byProduct.map((r) => [
      r.name,
      r.category,
      r.cashQty ? `${pdfQty(r.cashQty)} ${r.unit}` : "-",
      pdfAmount(r.cash),
      r.creditQty ? `${pdfQty(r.creditQty)} ${r.unit}` : "-",
      pdfAmount(r.credit),
      pdfAmount(r.total),
    ]),
    { right: [2, 3, 4, 5, 6], fontSize: 8 },
  );

  section(c, "Received cash from debtors");
  table(
    c,
    ["Date", "Customer", "Amount"],
    report.payments.map((p) => [pdfDateTime(p.createdAt), p.customerName, pdfAmount(p.amount)]),
    { right: [2], foot: ["Total", "", pdfAmount(report.totals.received)] },
  );

  if (multiDay) {
    section(c, "Summary by date");
    table(
      c,
      ["Date", "Bills", "Cash", "Credit", "Round-off", "Received", "Total"],
      report.byDay.map((d) => [
        d.day,
        d.bills,
        pdfAmount(d.cash),
        pdfAmount(d.credit),
        pdfAmount(d.roundOff),
        pdfAmount(d.received),
        pdfAmount(d.total),
      ]),
      { right: [1, 2, 3, 4, 5, 6] },
    );

    section(c, "Summary by date and category");
    table(
      c,
      ["Date", "Category", "Amount"],
      report.byDayCategory.flatMap((d) => d.rows.map((r, i) => [i === 0 ? d.day : "", r.name, pdfAmount(r.total)])),
      { right: [2] },
    );

    section(c, "Summary by date and product");
    table(
      c,
      ["Date", "Product", "Quantity", "Amount"],
      report.byDayProduct.flatMap((d) =>
        d.rows.map((r, i) => [i === 0 ? d.day : "", r.name, `${pdfQty(r.qty)} ${r.unit}`.trim(), pdfAmount(r.total)]),
      ),
      { right: [2, 3], fontSize: 8 },
    );
  }

  section(c, "Credit outstanding — all customers", `as of ${pdfDateTime(Date.now())}`);
  table(
    c,
    ["Customer", "Mobile", "Last payment", "Last paid on", "Balance"],
    report.outstanding.map((o) => [
      o.name,
      o.mobile || "-",
      o.lastPaymentAmount !== null ? pdfAmount(o.lastPaymentAmount) : "-",
      o.lastPaymentAt ? localDateKey(o.lastPaymentAt) : "-",
      pdfAmount(o.balance),
    ]),
    { right: [2, 4], foot: ["Total", "", "", "", pdfAmount(report.outstanding.reduce((s, o) => s + o.balance, 0))] },
  );

  footers(doc, `${SHOP_DETAILS.name} · Sales summary · ${label}`);
  doc.save(`VSP_Sales_Summary_${fileStamp()}.pdf`);
}

function billRows(bills: Bill[], userName: (uid: string) => string, unitOf: (id: string) => string) {
  return bills.flatMap((b) =>
    b.lines.map((l, i) => [
      i === 0 ? pdfDateTime(b.createdAt).slice(11) : "",
      i === 0 ? `#${b.no}` : "",
      i === 0 ? (b.customerName ?? "Walk-in") : "",
      l.name,
      `${pdfQty(l.qty)} ${unitOf(l.productId)}`.trim(),
      pdfAmount(l.price),
      pdfAmount(lineAmount(l)),
      i === 0 ? (b.paymentType === "credit" ? "CREDIT" : "CASH") : "",
      i === 0 ? userName(b.cashierId) : "",
    ]),
  );
}

/** The old app's "Detail Report" — every bill, line by line, grouped by day. */
export async function downloadDetailPdf(
  report: SalesReport,
  label: string,
  ctx: { userName: (uid: string) => string; unitOf: (productId: string) => string },
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const c: Ctx = { doc, autoTable, m: 12, y: 0 };
  c.y = letterhead(doc, "Sales detail", label);
  kpis(c, [...headlineCards(report), ...secondaryCards(report).slice(2)]);

  const head = ["Time", "Bill", "Customer", "Item", "Qty", "Price", "Amount", "Payment", "Cashier"];
  const byDay = new Map<string, Bill[]>();
  for (const b of report.bills) byDay.set(localDateKey(b.createdAt), [...(byDay.get(localDateKey(b.createdAt)) ?? []), b]);

  if (byDay.size === 0) {
    section(c, "Bills");
    table(c, head, []);
  }
  for (const [day, bills] of byDay) {
    const total = bills.reduce((s, b) => s + b.total, 0);
    section(c, `Bills · ${day}`, `${bills.length} bills`);
    table(c, head, billRows(bills, ctx.userName, ctx.unitOf), {
      right: [4, 5, 6],
      fontSize: 7.8,
      foot: ["", "", "", "", "", "Day total", pdfAmount(total), "", ""],
    });
    // Round-off isn't on any line, so call it out under the day it happened.
    const roundOff = bills.reduce((s, b) => s + b.discount, 0);
    if (roundOff > 0) {
      doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...BRAND.muted);
      doc.text(`Includes Rs ${pdfAmount(roundOff)} walk-in round-off taken off bill totals.`, c.m, c.y - 2);
      c.y += 3;
    }
  }

  section(c, "Deleted bills", `${report.voidBills.length} bills · Rs ${pdfAmount(report.totals.voided)}`);
  table(c, head, billRows(report.voidBills, ctx.userName, ctx.unitOf), { right: [4, 5, 6], fontSize: 7.8 });

  section(c, "Received cash from debtors");
  table(
    c,
    ["Date", "Customer", "Bills settled", "Amount"],
    report.payments.map((p) => [
      pdfDateTime(p.createdAt),
      p.customerName,
      p.allocations.map((a) => (a.billNo ? `#${a.billNo}` : "opening")).join(", "),
      pdfAmount(p.amount),
    ]),
    { right: [3], foot: ["Total", "", "", pdfAmount(report.totals.received)] },
  );

  footers(doc, `${SHOP_DETAILS.name} · Sales detail · ${label}`);
  doc.save(`VSP_Sales_Detail_${fileStamp()}.pdf`);
}
