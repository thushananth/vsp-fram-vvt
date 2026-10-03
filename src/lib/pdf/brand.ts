import type { jsPDF } from "jspdf";
import { POWERED_BY_LINE, SHOP_DETAILS } from "@/lib/constants";
import { localDateKey } from "@/lib/format";

/**
 * VSP Farm's look on paper: the amber of the app's logo mark over the deep
 * ink of its sidebar. Every PDF the app makes — bills and reports — draws its
 * letterhead and footer from here, so they all read as one brand.
 */
export const BRAND = {
  amber: [217, 119, 6] as [number, number, number],
  amberSoft: [254, 243, 199] as [number, number, number],
  ink: [15, 22, 41] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  line: [228, 233, 241] as [number, number, number],
  zebra: [248, 250, 252] as [number, number, number],
  green: [22, 163, 74] as [number, number, number],
  red: [220, 38, 38] as [number, number, number],
};

/** jsPDF and its table plugin, loaded only when a PDF is actually made. */
export async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

/** "1,375.00" */
export function pdfAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pdfQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function pdfDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${localDateKey(ms)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The logo mark — a rounded amber tile with the farm's initials. */
function mark(doc: jsPDF, x: number, y: number, size: number) {
  doc.setFillColor(...BRAND.amber).roundedRect(x, y, size, size, size * 0.28, size * 0.28, "F");
  doc
    .setFont("helvetica", "bold")
    .setFontSize(size * 1.15)
    .setTextColor(255, 255, 255)
    .text("VSP", x + size / 2, y + size * 0.62, { align: "center" });
}

/**
 * Ink band across the top: mark, shop name and contact on the left, the
 * document's title on the right. Returns the y the content can start at.
 */
export function letterhead(
  doc: jsPDF,
  title: string,
  subtitle: string,
  opts: { compact?: boolean } = {},
): number {
  const w = doc.internal.pageSize.getWidth();
  const h = opts.compact ? 26 : 32;
  doc.setFillColor(...BRAND.ink).rect(0, 0, w, h, "F");
  doc.setFillColor(...BRAND.amber).rect(0, h, w, 1.2, "F");

  const m = 12;
  const markSize = opts.compact ? 12 : 14;
  mark(doc, m, (h - markSize) / 2, markSize);

  const tx = m + markSize + 4;
  doc.setFont("helvetica", "bold").setFontSize(opts.compact ? 13 : 15).setTextColor(255, 255, 255);
  doc.text(SHOP_DETAILS.name, tx, h / 2 - 1);
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(203, 213, 225);
  doc.text(`${SHOP_DETAILS.address}  ·  ${SHOP_DETAILS.phone}`, tx, h / 2 + 4);

  doc.setFont("helvetica", "bold").setFontSize(opts.compact ? 12 : 14).setTextColor(...BRAND.amberSoft);
  doc.text(title.toUpperCase(), w - m, h / 2 - 1, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(203, 213, 225);
  doc.text(subtitle, w - m, h / 2 + 4, { align: "right" });

  doc.setTextColor(...BRAND.ink);
  return h + 10;
}

/** Page numbers, the shop line and the maker's credit on every page — call once, at the end. */
export function footers(doc: jsPDF, note: string) {
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
    doc.text(POWERED_BY_LINE.replace(" · ", "  ·  "), w / 2, h - 3.5, { align: "center" });
  }
}

/** Shared table look: amber-tinted head, quiet zebra rows, no heavy grid.
 *  `rightCols` are the number columns — their headings line up with them. */
export function tableStyle(fontSize = 8.5, rightCols: number[] = []) {
  return {
    didParseCell: (data: { section: string; column: { index: number }; cell: { styles: { halign: string } } }) => {
      if (data.section !== "body" && rightCols.includes(data.column.index)) data.cell.styles.halign = "right";
    },
    theme: "plain" as const,
    styles: {
      font: "helvetica",
      fontSize,
      textColor: BRAND.ink,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 },
      lineColor: BRAND.line,
    },
    headStyles: {
      fillColor: BRAND.amberSoft,
      textColor: [120, 53, 15] as [number, number, number],
      fontStyle: "bold" as const,
      fontSize: fontSize - 0.5,
    },
    alternateRowStyles: { fillColor: BRAND.zebra },
  };
}

export function fileStamp(ms: number = Date.now()): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${localDateKey(ms)}_${p(d.getHours())}${p(d.getMinutes())}`;
}
