import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * The customer's copy of an OR- bill, made on the server for the public track
 * page (which carries no app bundle). Keep the layout in step with
 * src/lib/pdf/billPdf.ts and src/lib/pdf/brand.ts, so it reads as the same
 * bill the shop sends on WhatsApp.
 *
 * Public link, so: no mobile number, no cashier, no ids.
 */

// Keep in step with SHOP_DETAILS / POWERED_BY in src/lib/constants.ts.
const SHOP = { name: "VSP FARM", address: "Theniyambai, Valvettithurai, Sri Lanka", phone: "077 023 8493" };
const POWERED_BY_LINE = "Powered by 5XCODES  ·  +94 76 770 7544";
const TZ = "Asia/Colombo";

type RGB = [number, number, number];
const BRAND = {
  amber: [217, 119, 6] as RGB,
  amberSoft: [254, 243, 199] as RGB,
  ink: [15, 22, 41] as RGB,
  muted: [100, 116, 139] as RGB,
  line: [228, 233, 241] as RGB,
  zebra: [248, 250, 252] as RGB,
  green: [22, 163, 74] as RGB,
  red: [220, 38, 38] as RGB,
};

export interface PdfBill {
  label: string;
  createdAt: number;
  customerName: string;
  paymentType: string;
  status: string;
  lines: { name: string; qty: number; unit: string; price: number; amount?: number; listPrice?: number }[];
  total: number;
  discount: number;
  advanceUsed: number;
  paid: number;
  due: number;
  tender: number;
  change: number;
  /** The customer's balance now (already including this bill's due), or null. */
  customerCredit: number | null;
}

const amount = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number) => String(Math.round(n * 1000) / 1000);
const lineAmount = (l: PdfBill["lines"][number]) => l.amount ?? Math.round(l.price * l.qty * 100) / 100;

function dateTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function fileName(bill: PdfBill): string {
  return `VSP_Bill_${bill.label}_${dateTime(bill.createdAt).replace(/[: ]/g, (c) => (c === " " ? "_" : ""))}.pdf`;
}

function letterhead(doc: jsPDF, title: string, subtitle: string): number {
  const w = doc.internal.pageSize.getWidth();
  const h = 26;
  doc.setFillColor(...BRAND.ink).rect(0, 0, w, h, "F");
  doc.setFillColor(...BRAND.amber).rect(0, h, w, 1.2, "F");
  const m = 12;
  const size = 12;
  const y0 = (h - size) / 2;
  doc.setFillColor(...BRAND.amber).roundedRect(m, y0, size, size, size * 0.28, size * 0.28, "F");
  doc.setFont("helvetica", "bold").setFontSize(size * 1.15).setTextColor(255, 255, 255);
  doc.text("VSP", m + size / 2, y0 + size * 0.62, { align: "center" });
  const tx = m + size + 4;
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(255, 255, 255).text(SHOP.name, tx, h / 2 - 1);
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(203, 213, 225);
  doc.text(`${SHOP.address}  ·  ${SHOP.phone}`, tx, h / 2 + 4);
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...BRAND.amberSoft);
  doc.text(title.toUpperCase(), w - m, h / 2 - 1, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(203, 213, 225);
  doc.text(subtitle, w - m, h / 2 + 4, { align: "right" });
  doc.setTextColor(...BRAND.ink);
  return h + 10;
}

function footers(doc: jsPDF, note: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BRAND.line).setLineWidth(0.3).line(12, h - 12, w - 12, h - 12);
    doc.setFont("helvetica", "normal").setFontSize(7).setTextColor(...BRAND.muted);
    doc.text(note, 12, h - 7);
    doc.text(`Page ${i} of ${pages}`, w - 12, h - 7, { align: "right" });
    doc.setFont("helvetica", "bold").setTextColor(...BRAND.amber);
    doc.text(POWERED_BY_LINE, w / 2, h - 3.5, { align: "center" });
  }
}

export function billPdf(bill: PdfBill): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const w = doc.internal.pageSize.getWidth();
  const m = 12;
  let y = letterhead(doc, bill.paymentType === "credit" ? "Credit bill" : "Receipt", `Bill ${bill.label}`);

  doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(...BRAND.muted);
  doc.text("BILLED TO", m, y);
  doc.text("BILL", w / 2 + 6, y);
  y += 5;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...BRAND.ink);
  doc.text(doc.splitTextToSize(bill.customerName || "Customer", w / 2 - m - 2)[0] as string, m, y);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text(`No. ${bill.label}`, w / 2 + 6, y);
  doc.setTextColor(...BRAND.muted);
  doc.text(dateTime(bill.createdAt), w / 2 + 6, y + 4.5);

  const st =
    bill.status === "void"
      ? { label: "VOID", color: BRAND.red }
      : bill.due > 0
        ? { label: bill.paid > 0 ? "PART PAID" : "ON CREDIT", color: BRAND.amber }
        : { label: "PAID", color: BRAND.green };
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  const pillW = doc.getTextWidth(st.label) + 7;
  doc.setFillColor(...st.color).roundedRect(w - m - pillW, y - 9.5, pillW, 6, 3, 3, "F");
  doc.setTextColor(255, 255, 255).text(st.label, w - m - pillW / 2, y - 5.4, { align: "center" });
  y += 16;

  const rightCols = [1, 2, 3];
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [["Item", "Qty", "Price", "Amount"]],
    body: bill.lines.map((l) => [
      l.listPrice !== undefined ? `${l.name}\n(normally ${amount(l.listPrice)})` : l.name,
      `${qty(l.qty)} ${l.unit}`.trim(),
      amount(l.price),
      amount(lineAmount(l)),
    ]),
    didParseCell: (data) => {
      if (data.section !== "body" && rightCols.includes(data.column.index)) data.cell.styles.halign = "right";
    },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: BRAND.ink, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: BRAND.line },
    headStyles: { fillColor: BRAND.amberSoft, textColor: [120, 53, 15], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: BRAND.zebra },
    columnStyles: {
      1: { halign: "right", cellWidth: 22 },
      2: { halign: "right", cellWidth: 24 },
      3: { halign: "right", cellWidth: 26, fontStyle: "bold" },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const rows: [string, string][] = [];
  if (bill.discount > 0) {
    rows.push(["Subtotal", amount(bill.total + bill.discount)]);
    rows.push(["Round-off", `- ${amount(bill.discount)}`]);
  }
  const after: [string, string][] = bill.advanceUsed > 0 ? [["Advance used", `- ${amount(bill.advanceUsed)}`]] : [];
  if (bill.paymentType === "credit") after.push(["Paid", amount(bill.paid)], ["Balance due", amount(bill.due)]);
  else after.push(["Cash", amount(bill.tender)], ["Change", amount(bill.change)]);
  if (bill.customerCredit !== null && bill.status !== "void") {
    const owed = bill.customerCredit;
    const before = Math.max(0, owed - bill.due);
    if (owed > 0 || before > 0) after.push(["Previous credit", amount(before)], ["Total credit owed", amount(owed)]);
  }

  const cardW = 70;
  const cardX = w - m - cardW;
  const cardH = rows.length * 5.5 + 13 + after.length * 5.5 + 4;
  if (y + cardH > doc.internal.pageSize.getHeight() - 24) {
    doc.addPage();
    y = 16;
  }
  doc.setFillColor(...BRAND.zebra).roundedRect(cardX, y, cardW, cardH, 3, 3, "F");
  let cy = y + 6;
  doc.setFontSize(8.5);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal").setTextColor(...BRAND.muted).text(label, cardX + 4, cy);
    doc.setTextColor(...BRAND.ink).text(value, cardX + cardW - 4, cy, { align: "right" });
    cy += 5.5;
  }
  doc.setFillColor(...BRAND.amber).roundedRect(cardX + 2, cy - 3.5, cardW - 4, 10, 2, 2, "F");
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(255, 255, 255).text("TOTAL", cardX + 5, cy + 2.8);
  doc.setFontSize(12).text(`Rs ${amount(bill.total)}`, cardX + cardW - 5, cy + 3, { align: "right" });
  cy += 13;
  doc.setFontSize(8.5);
  for (const [label, value] of after) {
    doc.setFont("helvetica", "normal").setTextColor(...BRAND.muted).text(label, cardX + 4, cy);
    doc.setFont("helvetica", "bold").setTextColor(...BRAND.ink).text(value, cardX + cardW - 4, cy, { align: "right" });
    cy += 5.5;
  }

  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...BRAND.ink);
  doc.text("Thank you!", m, y + 7);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...BRAND.muted);
  doc.text(doc.splitTextToSize(`Fresh from ${SHOP.name}. Questions about this bill? Call ${SHOP.phone}.`, cardX - m - 6), m, y + 12.5);

  footers(doc, `${SHOP.name} · Bill ${bill.label}`);
  return Buffer.from(doc.output("arraybuffer"));
}
