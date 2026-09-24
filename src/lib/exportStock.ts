"use client";

import { downloadFile } from "@/lib/exportBills";

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = [
  "Item",
  "Category",
  "Type",
  "Unit",
  "Price",
  "Cost price",
  "In stock",
  "Stock value",
  "Min level",
  "Max level",
  "Status",
  "Expiry date",
] as const;

export interface StockReportRow {
  name: string;
  category: string;
  isBakery: boolean;
  unit: string;
  price: number;
  costPrice: number;
  qty: number;
  minLevel: number | null;
  maxLevel: number | null;
  status: string;
  expiryDate: string | null;
}

export function stockRowsToCsv(rows: StockReportRow[]): string {
  const body = rows.map((r) =>
    [
      r.name,
      r.category,
      r.isBakery ? "Farm Products" : "Barcoded good",
      r.unit,
      r.price.toFixed(2),
      r.costPrice.toFixed(2),
      r.qty,
      (r.qty * r.price).toFixed(2),
      r.minLevel ?? "",
      r.maxLevel ?? "",
      r.status,
      r.expiryDate ?? "",
    ].map(csvCell).join(","),
  );
  // BOM so Excel opens the file as UTF-8 rather than mangling item names.
  return `﻿${HEADERS.join(",")}\n${body.join("\n")}\n`;
}

export function exportStockCsv(rows: StockReportRow[]): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadFile(`stock-report-${stamp}.csv`, stockRowsToCsv(rows), "text/csv;charset=utf-8");
}
