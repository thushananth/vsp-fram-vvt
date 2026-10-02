import { SHOP_DETAILS } from "@/lib/constants";
import { localDateKey } from "@/lib/format";
import type { Bill, CreditPayment, Customer } from "@/lib/types";

/**
 * One customer's activity inside a date range. Built from the bills and
 * creditPayments already loaded for the Sales report — nothing is written or
 * copied, it is all derived on the client.
 */
export interface CustomerReportRow {
  customerId: string;
  name: string;
  mobileNumber: string;
  /** Non-void bills in range. */
  bills: Bill[];
  voidBills: Bill[];
  payments: CreditPayment[];
  cash: number;
  credit: number;
  /** cash + credit — voided bills are shown apart as "Deleted". */
  total: number;
  deleted: number;
  received: number;
  /** Current balance owed, not range-bound — the customer's running total. */
  outstanding: number;
  lastPurchaseAt: number;
}

export function buildCustomerReport(params: {
  bills: Bill[];
  payments: CreditPayment[];
  customers: Customer[];
  startMs: number;
  endMs: number;
}): CustomerReportRow[] {
  const { bills, payments, customers, startMs, endMs } = params;
  const byId = new Map(customers.map((c) => [c.id, c]));
  const rows = new Map<string, CustomerReportRow>();

  function rowFor(customerId: string, fallbackName: string | null): CustomerReportRow {
    let row = rows.get(customerId);
    if (!row) {
      const c = byId.get(customerId);
      row = {
        customerId,
        name: c?.name || fallbackName || "Unknown customer",
        mobileNumber: c?.mobileNumber ?? "",
        bills: [],
        voidBills: [],
        payments: [],
        cash: 0,
        credit: 0,
        total: 0,
        deleted: 0,
        received: 0,
        outstanding: c?.remainingCredit ?? 0,
        lastPurchaseAt: 0,
      };
      rows.set(customerId, row);
    }
    return row;
  }

  for (const b of bills) {
    // Walk-in cash sales carry no customer, so they have no statement.
    if (!b.customerId || b.createdAt < startMs || b.createdAt >= endMs) continue;
    const row = rowFor(b.customerId, b.customerName);
    if (b.status === "void") {
      row.voidBills.push(b);
      row.deleted += b.total;
      continue;
    }
    row.bills.push(b);
    if (b.paymentType === "credit") row.credit += b.total;
    else row.cash += b.total;
    row.total += b.total;
    row.lastPurchaseAt = Math.max(row.lastPurchaseAt, b.createdAt);
  }

  for (const p of payments) {
    if (!p.customerId || p.createdAt < startMs || p.createdAt >= endMs) continue;
    const row = rowFor(p.customerId, p.customerName);
    row.payments.push(p);
    row.received += p.amount;
  }

  for (const row of rows.values()) {
    row.bills.sort((a, b) => b.createdAt - a.createdAt);
    row.voidBills.sort((a, b) => b.createdAt - a.createdAt);
    row.payments.sort((a, b) => b.createdAt - a.createdAt);
  }

  return [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export { localDateKey };

/** "210 376.00" — the statement's own number style. */
function amount(n: number): string {
  return n
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/,/g, " ");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Lookups the statement needs beyond the bill itself: the product's category
 * (the "Item" column — the line's own name is the "Sub Item") and who rang it
 * up. Both optional; a missing lookup just leaves the cell blank.
 */
export interface ReportContext {
  categoryOf?: (productId: string, categoryId?: string) => string | undefined;
  userName?: (uid: string) => string | undefined;
}

export const BILL_COLUMNS = [
  "Date",
  "Time",
  "Customer",
  "Ref No",
  "Item",
  "Sub Item",
  "Discount",
  "Quantity",
  "Price",
  "Payment",
  "Status",
  "User",
] as const;

/** One printed line of a bill, in BILL_COLUMNS order. */
export interface BillLineRow {
  key: string;
  date: string;
  time: string;
  customer: string;
  refNo: string;
  item: string;
  subItem: string;
  discount: number;
  qty: number;
  /** The line's amount — price × quantity, as the shop's statements show it. */
  price: number;
  payment: "CASH" | "CREDIT";
  status: "NEW" | "DELETED";
  user: string;
}

function timeKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function billLineRows(bills: Bill[], customerName: string, ctx: ReportContext = {}): BillLineRow[] {
  return bills.flatMap((b) =>
    b.lines.map((l, i) => ({
      key: `${b.id}-${i}`,
      date: localDateKey(b.createdAt),
      time: timeKey(b.createdAt),
      customer: b.customerName || customerName,
      refNo: String(b.no),
      item: ctx.categoryOf?.(l.productId, l.categoryId) ?? "",
      subItem: l.name,
      // Only an overridden line carries listPrice — anything else sold at list.
      discount: l.listPrice !== undefined ? Math.max(0, (l.listPrice - l.price) * l.qty) : 0,
      qty: l.qty,
      price: l.price * l.qty,
      payment: b.paymentType === "credit" ? "CREDIT" : "CASH",
      status: b.status === "void" ? "DELETED" : "NEW",
      user: ctx.userName?.(b.cashierId) ?? "",
    })),
  );
}

/** Bills newest-day first, each day's bills oldest-first within it. */
export function groupBillsByDay(bills: Bill[]): [string, Bill[]][] {
  const byDay = new Map<string, Bill[]>();
  for (const b of [...bills].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = localDateKey(b.createdAt);
    byDay.set(key, [...(byDay.get(key) ?? []), b]);
  }
  return [...byDay.entries()].map(([day, list]) => [day, list.reverse()]);
}

function qtyText(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function billsByDaySection(title: string, bills: Bill[], customerName: string, ctx: ReportContext): string {
  if (bills.length === 0) return "";
  const days = groupBillsByDay(bills)
    .map(([day, dayBills]) => {
      const lines = billLineRows(dayBills, customerName, ctx)
        .map(
          (r) => `<tr>
            <td>${r.date}</td><td>${r.time}</td><td>${esc(r.customer)}</td><td>${r.refNo}</td>
            <td>${esc(r.item)}</td><td>${esc(r.subItem)}</td><td class="n">${amount(r.discount)}</td>
            <td class="n">${qtyText(r.qty)}</td><td class="n">${amount(r.price)}</td>
            <td class="${r.payment === "CREDIT" ? "credit" : ""}">${r.payment}</td>
            <td>${r.status}</td><td>${esc(r.user)}</td>
          </tr>`,
        )
        .join("");
      const dayTotal = dayBills.reduce((t, b) => t + b.total, 0);
      return `<div class="day">
        <p class="date">Date: ${day}</p>
        <table class="bills">
          <thead><tr>${BILL_COLUMNS.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <p class="total">Total = ${amount(dayTotal)}</p>
      </div>`;
    })
    .join("");
  return `<hr /><h2>${title}</h2>${days}`;
}

/**
 * Printable statement for one customer, laid out like the shop's existing
 * "VSP_Customer_Report_…" PDFs: letterhead, summary, cash received from the
 * debtor, then the bills grouped by day.
 */
export function customerReportHtml(
  row: CustomerReportRow,
  range: { from: string; to: string },
  ctx: ReportContext = {},
): string {
  const received = row.payments
    .map(
      (p) => `<tr>
        <td>${localDateKey(p.createdAt)}</td>
        <td class="clip">${esc(row.name)}</td>
        <td class="n">${amount(p.amount)}</td>
      </tr>`,
    )
    .join("");
  const title = `VSP_Customer_Report_${row.name}_${localDateKey(Date.now())}`;

  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  body { font-family: Roboto, Arial, sans-serif; color: #000; font-size: 13px; }
  header { text-align: center; line-height: 1.35; }
  header h1 { font-size: 20px; margin: 0; }
  h2 { font-size: 16px; margin: 22px 0 10px; }
  .title { font-size: 16px; font-weight: 700; margin: 22px 0 2px; }
  table { border-collapse: collapse; margin: 6px 0; }
  th, td { border: 1.5px solid #000; padding: 5px 9px; text-align: left; }
  th { font-weight: 700; }
  .n { text-align: right; white-space: nowrap; }
  .clip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary td, .summary th { min-width: 110px; }
  hr { border: 0; border-top: 2px solid #000; margin: 26px 0 0; }
  .day { break-inside: avoid; margin-bottom: 14px; }
  .date { font-size: 14px; margin: 16px 0 4px; }
  .total { text-align: center; font-size: 15px; font-weight: 700; margin: 4px 0; }
  table.bills { width: 100%; font-size: 10px; }
  table.bills th, table.bills td { padding: 4px 5px; }
  .credit { color: #d11; }
  .muted { color: #555; }
</style></head>
<body>
  <header>
    <h1>${esc(SHOP_DETAILS.name)}</h1>
    <div>${esc(SHOP_DETAILS.address)}</div>
    <div>${esc(SHOP_DETAILS.phone)}</div>
  </header>

  <p class="title">Sales Report - ${esc(row.name)}</p>
  <div>Date: ${esc(range.from)} —&gt; ${esc(range.to)}</div>

  <h2>Summary</h2>
  <table class="summary">
    <thead><tr><th>Total</th><th>Cash</th><th>Credit</th><th>Deleted</th></tr></thead>
    <tbody><tr>
      <td>${amount(row.total)}</td><td>${amount(row.cash)}</td>
      <td>${amount(row.credit)}</td><td>${amount(row.deleted)}</td>
    </tr></tbody>
  </table>

  <hr />
  <h2>Received Cash from Debtors</h2>
  ${
    received
      ? `<table><thead><tr><th>Date</th><th>Customer</th><th>Amount</th></tr></thead><tbody>${received}</tbody></table>`
      : `<p class="muted">No payments received in this period.</p>`
  }

  ${billsByDaySection("Credit Bills", row.bills.filter((b) => b.paymentType === "credit"), row.name, ctx)}
  ${billsByDaySection("Cash Bills", row.bills.filter((b) => b.paymentType !== "credit"), row.name, ctx)}
  ${billsByDaySection("Deleted Bills", row.voidBills, row.name, ctx)}

  <script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`;
}

/**
 * Opens the statement in a new tab and brings up the print dialog, where
 * "Save as PDF" produces the file. Must be called from a click handler or the
 * popup blocker will stop it.
 */
export function printCustomerReport(
  row: CustomerReportRow,
  range: { from: string; to: string },
  ctx: ReportContext = {},
): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(customerReportHtml(row, range, ctx));
  win.document.close();
  return true;
}

/** "2026-09-29 08_33_56" — the timestamp style in the shop's existing PDF names. */
function fileStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localDateKey(ms)} ${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

/**
 * The same statement as customerReportHtml, saved straight to a .pdf file —
 * no print dialog. jsPDF is loaded on demand so it never weighs on Billing.
 */
export async function downloadCustomerReportPdf(
  row: CustomerReportRow,
  range: { from: string; to: string },
  ctx: ReportContext = {},
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  let y = margin + 4;

  // Moves to a new page when `needed` mm won't fit on this one.
  const ensure = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const heading = (text: string, size = 13) => {
    ensure(14);
    doc.setFont("helvetica", "bold").setFontSize(size).text(text, margin, y);
    y += 4;
  };
  const rule = () => {
    ensure(10);
    y += 4;
    doc.setLineWidth(0.6).line(margin, y, pageW - margin, y);
    y += 9;
  };
  const table = (head: string[], body: (string | number)[][], rightCols: number[] = []) => {
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      theme: "grid",
      margin: { left: margin, right: margin },
      tableWidth: "wrap",
      styles: { font: "helvetica", fontSize: 10, textColor: 0, lineColor: 0, lineWidth: 0.35, cellPadding: 2 },
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
      columnStyles: Object.fromEntries(rightCols.map((c) => [c, { halign: "right" as const }])),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  };

  // Letterhead
  doc.setFont("helvetica", "bold").setFontSize(16).text(SHOP_DETAILS.name, pageW / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(12);
  doc.text(SHOP_DETAILS.address, pageW / 2, (y += 6), { align: "center" });
  doc.text(SHOP_DETAILS.phone, pageW / 2, (y += 6), { align: "center" });
  y += 12;

  doc.setFont("helvetica", "bold").setFontSize(13).text(`Sales Report - ${row.name}`, margin, y);
  doc.setFont("helvetica", "normal").setFontSize(12).text(`Date: ${range.from} --> ${range.to}`, margin, (y += 6));
  y += 12;

  heading("Summary");
  table(["Total", "Cash", "Credit", "Deleted"], [
    [amount(row.total), amount(row.cash), amount(row.credit), amount(row.deleted)],
  ]);

  rule();
  heading("Received Cash from Debtors");
  if (row.payments.length) {
    table(
      ["Date", "Customer", "Amount"],
      row.payments.map((p) => [
        localDateKey(p.createdAt),
        row.name.length > 22 ? `${row.name.slice(0, 20)}...` : row.name,
        amount(p.amount),
      ]),
      [2],
    );
  } else {
    doc.setFont("helvetica", "normal").setFontSize(10).text("No payments received in this period.", margin, (y += 2));
    y += 4;
  }

  const section = (title: string, bills: Bill[]) => {
    if (bills.length === 0) return;
    rule();
    heading(title);
    for (const [day, dayBills] of groupBillsByDay(bills)) {
      ensure(26);
      doc.setFont("helvetica", "normal").setFontSize(12).text(`Date: ${day}`, margin, (y += 3));
      y += 3;
      const rows = billLineRows(dayBills, row.name, ctx);
      autoTable(doc, {
        startY: y,
        head: [[...BILL_COLUMNS]],
        body: rows.map((r) => [
          r.date,
          r.time,
          r.customer,
          r.refNo,
          r.item,
          r.subItem,
          amount(r.discount),
          qtyText(r.qty),
          amount(r.price),
          r.payment,
          r.status,
          r.user,
        ]),
        theme: "grid",
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 7, textColor: 0, lineColor: 0, lineWidth: 0.35, cellPadding: 1.4 },
        headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
        columnStyles: { 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
        // CREDIT in red, as on the shop's statements.
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 9 && data.cell.raw === "CREDIT") {
            data.cell.styles.textColor = [209, 17, 17];
          }
        },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
      ensure(10);
      doc
        .setFont("helvetica", "bold")
        .setFontSize(13)
        .text(`Total = ${amount(dayBills.reduce((t, b) => t + b.total, 0))}`, pageW / 2, (y += 6), {
          align: "center",
        });
      y += 8;
    }
  };
  section("Credit Bills", row.bills.filter((b) => b.paymentType === "credit"));
  section("Cash Bills", row.bills.filter((b) => b.paymentType !== "credit"));
  section("Deleted Bills", row.voidBills);

  const safeName = row.name.replace(/[\\/:*?"<>|]/g, "").trim() || "Customer";
  doc.save(`VSP_Customer_Report_${safeName}_${fileStamp(Date.now())}.pdf`);
}

/** A customer with nothing in the range still gets a (zeroed) statement. */
export function emptyCustomerRow(customer: Customer): CustomerReportRow {
  return {
    customerId: customer.id,
    name: customer.name,
    mobileNumber: customer.mobileNumber,
    bills: [],
    voidBills: [],
    payments: [],
    cash: 0,
    credit: 0,
    total: 0,
    deleted: 0,
    received: 0,
    outstanding: customer.remainingCredit,
    lastPurchaseAt: 0,
  };
}
