"use client";

import type { JournalEntry } from "@/lib/billJournal";
import type { Bill } from "@/lib/types";
import { localDateKey } from "@/lib/format";

/**
 * Getting bills off the till without a server. Everything here works from data
 * already in memory — no network call — so a shop that has been offline all day
 * can still hand its takings to the accountant on a USB stick.
 */

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = [
  "Bill No",
  "Date",
  "Time",
  "Status",
  "Sync",
  "Payment",
  "Customer",
  "Total",
  "Paid",
  "Due",
  "Tender",
  "Change",
  "Cashier",
  "Items",
] as const;

/** One row per bill; the lines are folded into a single readable cell. */
export interface ExportableBill {
  no: number;
  createdAt: number;
  status: string;
  sync: string;
  paymentType: string;
  customerName: string | null;
  total: number;
  paid: number;
  due: number;
  tender: number;
  change: number;
  cashierId: string;
  lines: { name: string; qty: number; price: number }[];
}

export function billToExportable(bill: Bill): ExportableBill {
  return {
    no: bill.no,
    createdAt: bill.createdAt,
    status: bill.status,
    sync: bill.synced ? "synced" : "queued",
    paymentType: bill.paymentType,
    customerName: bill.customerName,
    total: bill.total,
    paid: bill.paid,
    due: bill.due,
    tender: bill.tender,
    change: bill.change,
    cashierId: bill.cashierId,
    lines: bill.lines,
  };
}

/** A bill the server refused — it exists nowhere else, so it must export too. */
export function journalToExportable(entry: JournalEntry): ExportableBill {
  return {
    no: entry.no,
    createdAt: entry.createdAt,
    status: "paid",
    sync: entry.state === "failed" ? `rejected: ${entry.error ?? "unknown"}` : "queued",
    paymentType: entry.paymentType,
    customerName: entry.customerName,
    total: entry.total,
    // Taken from the entry, never re-derived from paymentType: a bill part-paid
    // at the till would otherwise export as owing its whole total.
    paid: entry.paid,
    due: Math.round((entry.total - entry.paid) * 100) / 100,
    tender: entry.tender,
    change: entry.change,
    cashierId: entry.cashierId,
    lines: entry.lines,
  };
}

function itemsCell(lines: ExportableBill["lines"]): string {
  return lines.map((l) => `${l.name} x${l.qty} @ ${l.price.toFixed(2)}`).join("; ");
}

export function billsToCsv(bills: ExportableBill[]): string {
  const rows = bills.map((b) => {
    const at = new Date(b.createdAt);
    return [
      b.no,
      Number.isFinite(b.createdAt) && b.createdAt > 0 ? localDateKey(b.createdAt) : "",
      Number.isFinite(b.createdAt) && b.createdAt > 0 ? at.toTimeString().slice(0, 8) : "",
      b.status,
      b.sync,
      b.paymentType,
      b.customerName ?? "",
      b.total.toFixed(2),
      b.paid.toFixed(2),
      b.due.toFixed(2),
      b.tender.toFixed(2),
      b.change.toFixed(2),
      b.cashierId,
      itemsCell(b.lines),
    ].map(csvCell).join(",");
  });
  // BOM so Excel opens the file as UTF-8 rather than mangling customer names.
  return `﻿${HEADERS.join(",")}\n${rows.join("\n")}\n`;
}

/** Hand the file to the browser. No network, no server round-trip. */
export function downloadFile(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick — Safari needs the URL to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportBillsCsv(bills: ExportableBill[], label: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadFile(`bills-${label}-${stamp}.csv`, billsToCsv(bills), "text/csv;charset=utf-8");
}

/** The full, lossless copy — what you send support if a bill has to be rebuilt. */
export function exportBillsJson(bills: ExportableBill[], label: string): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  downloadFile(
    `bills-${label}-${stamp}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), count: bills.length, bills }, null, 2),
    "application/json",
  );
}
