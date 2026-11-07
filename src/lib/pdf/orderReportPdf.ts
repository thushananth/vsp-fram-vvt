import { SHOP_DETAILS } from "@/lib/constants";
import { BRAND, fileStamp, footers, letterhead, loadPdf, pdfAmount, tableStyle } from "@/lib/pdf/brand";
import { ORDER_STATUS_LABEL, estimatedTotal, linesSummary, orderLabel, qtyText, shortDate, type OrderReport } from "@/lib/orders";
import type { Order } from "@/lib/types";

/** The Order reports screen as an A4 PDF: totals, by product, by customer, every order. */
export async function downloadOrderReportPdf(
  report: OrderReport,
  ctx: { from: string; to: string; filters: string[]; nameOf: (o: Order) => string },
): Promise<void> {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const m = 12;
  let y = letterhead(doc, "Order report", `${shortDate(ctx.from)} – ${shortDate(ctx.to)} (delivery day)`);

  if (ctx.filters.length) {
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...BRAND.muted);
    doc.text(`Filtered: ${ctx.filters.join(" · ")}`, m, y);
    y += 6;
  }

  const live = report.orders.length - report.counts.cancelled - report.billDeleted;
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [["Orders", "Delivered", "Out", "To send", "Cancelled", "Closed", "Est. value (Rs)"]],
    body: [[
      String(live),
      String(report.counts.delivered),
      String(report.counts.out),
      String(report.counts.confirmed),
      String(report.counts.cancelled),
      String(report.billDeleted),
      pdfAmount(report.value),
    ]],
    ...tableStyle(9, [0, 1, 2, 3, 4, 5, 6]),
    columnStyles: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [i, { halign: "right" as const }])),
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const heading = (text: string) => {
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...BRAND.ink).text(text, m, y);
    y += 2;
  };

  if (report.byProduct.length) {
    heading("By product (excluding cancelled)");
    autoTable(doc, {
      startY: y,
      margin: { left: m, right: m },
      head: [["Product", "Orders", "Qty", "Est. value"]],
      body: report.byProduct.map((p) => [p.name, String(p.orders), qtyText(p.qty, p.unit), pdfAmount(p.value)]),
      ...tableStyle(8.5, [1, 2, 3]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (report.byCustomer.length) {
    heading("By customer (excluding cancelled)");
    autoTable(doc, {
      startY: y,
      margin: { left: m, right: m },
      head: [["Customer", "Orders", "Est. value"]],
      body: report.byCustomer.map((c) => [c.name, String(c.orders), pdfAmount(c.value)]),
      ...tableStyle(8.5, [1, 2]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  heading("Orders");
  autoTable(doc, {
    startY: y,
    margin: { left: m, right: m },
    head: [["Order", "Day", "Customer", "Status", "Items", "Est. value"]],
    body: report.orders.map((o) => [
      orderLabel(o.orderNo),
      shortDate(o.deliveryDate),
      ctx.nameOf(o),
      o.billVoided ? "Closed\n(bill deleted)" : ORDER_STATUS_LABEL[o.status],
      linesSummary(o.lines),
      o.status === "cancelled" || o.billVoided ? "-" : pdfAmount(estimatedTotal(o)),
    ]),
    ...tableStyle(8, [5]),
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 22 },
      2: { cellWidth: 34 },
      3: { cellWidth: 24 },
      5: { halign: "right", cellWidth: 24, fontStyle: "bold" },
    },
  });

  footers(doc, `${SHOP_DETAILS.name} · Order report · ${ctx.from} to ${ctx.to}`);
  doc.save(`VSP_Orders_${ctx.from}_to_${ctx.to}_${fileStamp()}.pdf`);
}
