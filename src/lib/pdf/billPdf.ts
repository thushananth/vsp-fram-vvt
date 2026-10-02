import { SHOP_DETAILS } from "@/lib/constants";
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

function status(bill: Bill): { label: string; color: [number, number, number] } {
  if (bill.status === "void") return { label: "VOID", color: BRAND.red };
  if (bill.due > 0) return { label: bill.paid > 0 ? "PART PAID" : "ON CREDIT", color: BRAND.amber };
  return { label: "PAID", color: BRAND.green };
}

/**
 * One bill as a branded A5 PDF — the copy a customer gets on WhatsApp or by
 * email. Same facts as the thermal receipt, laid out for a screen.
 */
export async function downloadBillPdf(
  bill: Bill,
  ctx: { unitOf: (productId: string) => string; customerMobile?: string; cashierName?: string },
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const w = doc.internal.pageSize.getWidth();
  const m = 12;
  let y = letterhead(doc, bill.paymentType === "credit" ? "Credit bill" : "Receipt", `Bill #${bill.no}`, {
    compact: true,
  });

  // Billed to · bill facts, side by side.
  doc.setFont("helvetica", "bold").setFontSize(7).setTextColor(...BRAND.muted);
  doc.text("BILLED TO", m, y);
  doc.text("BILL", w / 2 + 6, y);
  y += 5;
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...BRAND.ink);
  doc.text(bill.customerName ?? "Walk-in customer", m, y);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text(`No. ${bill.no}`, w / 2 + 6, y);
  doc.setTextColor(...BRAND.muted);
  if (ctx.customerMobile) doc.text(ctx.customerMobile, m, y + 4.5);
  doc.text(pdfDateTime(bill.createdAt), w / 2 + 6, y + 4.5);
  if (ctx.cashierName) doc.text(`Served by ${ctx.cashierName}`, w / 2 + 6, y + 9);

  // Status pill, top right of the block.
  const st = status(bill);
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  const pillW = doc.getTextWidth(st.label) + 7;
  doc.setFillColor(...st.color).roundedRect(w - m - pillW, y - 9.5, pillW, 6, 3, 3, "F");
  doc.setTextColor(255, 255, 255).text(st.label, w - m - pillW / 2, y - 5.4, { align: "center" });
  y += 16;

  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [["Item", "Qty", "Price", "Amount"]],
    body: bill.lines.map((l) => [
      l.listPrice !== undefined ? `${l.name}\n(normally ${pdfAmount(l.listPrice)})` : l.name,
      `${pdfQty(l.qty)} ${ctx.unitOf(l.productId)}`.trim(),
      pdfAmount(l.price),
      pdfAmount(l.price * l.qty),
    ]),
    ...tableStyle(9, [1, 2, 3]),
    columnStyles: {
      1: { halign: "right", cellWidth: 22 },
      2: { halign: "right", cellWidth: 24 },
      3: { halign: "right", cellWidth: 26, fontStyle: "bold" },
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  // Totals card, right-aligned.
  const rows: [string, string, boolean?][] = [];
  if (bill.discount > 0) {
    rows.push(["Subtotal", pdfAmount(bill.total + bill.discount)]);
    rows.push(["Round-off", `- ${pdfAmount(bill.discount)}`]);
  }
  const after: [string, string][] =
    bill.paymentType === "credit"
      ? [
          ["Paid", pdfAmount(bill.paid)],
          ["Balance due", pdfAmount(bill.due)],
        ]
      : [
          ["Cash", pdfAmount(bill.tender)],
          ["Change", pdfAmount(bill.change)],
        ];
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
  doc.setFontSize(12).text(`Rs ${pdfAmount(bill.total)}`, cardX + cardW - 5, cy + 3, { align: "right" });
  cy += 13;
  doc.setFontSize(8.5);
  for (const [label, value] of after) {
    doc.setFont("helvetica", "normal").setTextColor(...BRAND.muted).text(label, cardX + 4, cy);
    doc.setFont("helvetica", "bold").setTextColor(...BRAND.ink).text(value, cardX + cardW - 4, cy, { align: "right" });
    cy += 5.5;
  }

  // Thank-you note on the left of the card.
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...BRAND.ink);
  doc.text("Thank you!", m, y + 7);
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...BRAND.muted);
  doc.text(doc.splitTextToSize(`Fresh from ${SHOP_DETAILS.name}. Questions about this bill? Call ${SHOP_DETAILS.phone}.`, cardX - m - 6), m, y + 12.5);

  footers(doc, `${SHOP_DETAILS.name} · Bill #${bill.no}`);
  doc.save(`VSP_Bill_${bill.no}_${fileStamp(bill.createdAt)}.pdf`);
}
