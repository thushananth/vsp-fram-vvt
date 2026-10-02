"use client";

import { useSyncExternalStore } from "react";
import type { BillLine, PaymentType } from "@/lib/types";

/**
 * A plain-text copy of every bill this device has written but not yet seen
 * acknowledged by the server.
 *
 * Firestore's own queue already survives a reload, so this is not a second
 * source of truth — it exists for the one case that queue can't cover: a
 * queued write that is *rejected* when it finally flushes (expired token,
 * device de-approved, rules changed). Firestore drops such a write silently,
 * and without this the sale would be gone. Entries are removed the moment the
 * server acknowledges them, so in normal use the journal sits empty.
 */

const JOURNAL_KEY = "chickenfarm.billJournal";
const JOURNAL_EVENT = "bakeshop:billJournal";
/** Bounded so a device stuck offline for weeks can't fill localStorage. */
const MAX_ENTRIES = 1000;

export interface JournalEntry {
  /** The Firestore document id — the same one the queued write targets, so a
   *  retry overwrites rather than duplicates. */
  id: string;
  no: number;
  provisional: boolean;
  createdAt: number;
  cashierId: string;
  lines: BillLine[];
  total: number;
  /** What was handed over at the till. `total - paid` is what is still owed. */
  paid: number;
  tender: number;
  change: number;
  paymentType: PaymentType;
  customerId: string | null;
  customerName: string | null;
  /** Walk-in round-off — see Bill.discount. */
  discount?: number;
  state: "pending" | "failed";
  /** Why the server refused it. Only set once state is "failed". */
  error: string | null;
}

function read(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JournalEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: JournalEntry[]): void {
  try {
    window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode. Nothing useful to do — the Firestore queue is
    // still carrying the bill; this copy is the belt to its braces.
  }
  window.dispatchEvent(new Event(JOURNAL_EVENT));
}

/** Trim oldest *pending* entries first — a failed bill is never dropped. */
function bounded(entries: JournalEntry[]): JournalEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;
  const failed = entries.filter((e) => e.state === "failed");
  const pending = entries.filter((e) => e.state !== "failed");
  return [...failed, ...pending.slice(-(MAX_ENTRIES - failed.length))];
}

export function recordPending(entry: Omit<JournalEntry, "state" | "error">): void {
  write(bounded([...read(), { ...entry, state: "pending", error: null }]));
}

/** The server took it — the journal's job for this bill is done. */
export function clearEntry(id: string): void {
  const entries = read();
  const next = entries.filter((e) => e.id !== id);
  if (next.length !== entries.length) write(next);
}

export function markFailed(id: string, error: string): void {
  write(read().map((e) => (e.id === id ? { ...e, state: "failed", error } : e)));
}

export function readJournal(): JournalEntry[] {
  return read();
}

/**
 * Cached so the snapshot below keeps a stable identity between renders — a
 * fresh array every time would loop useSyncExternalStore forever. Re-read only
 * when something actually changes the store.
 */
let snapshot: JournalEntry[] = [];
let snapshotLoaded = false;

const EMPTY: JournalEntry[] = [];

function getSnapshot(): JournalEntry[] {
  if (!snapshotLoaded) {
    snapshot = read();
    snapshotLoaded = true;
  }
  return snapshot;
}

/** Prerender has no localStorage, so the server's view is always empty. */
function getServerSnapshot(): JournalEntry[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  const handle = () => {
    snapshot = read();
    snapshotLoaded = true;
    onChange();
  };
  // The custom event covers this tab; `storage` covers a second till tab on
  // the same browser, which shares the journal.
  window.addEventListener(JOURNAL_EVENT, handle);
  window.addEventListener("storage", handle);
  return () => {
    window.removeEventListener(JOURNAL_EVENT, handle);
    window.removeEventListener("storage", handle);
  };
}

/** Live view of the journal, updated from this tab and from any other. */
export function useBillJournal(): JournalEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
