"use client";

import { useCallback, useSyncExternalStore } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { FirestoreError, Unsubscribe } from "firebase/firestore";
import { auth } from "@/lib/firebase";

/**
 * One shared, cached Firestore listener per query, for the whole app.
 *
 * Every screen used to open its own `onSnapshot` on mount and start from an
 * empty list with `loading: true`. Moving Billing → Bills → Billing tore the
 * products listener down and built it again, so the till showed "Loading…"
 * for products it had on screen a second earlier. On a cheap tablet the
 * IndexedDB round trip alone is long enough to read as the app being stuck.
 *
 * Here a query is identified by a string key. The first screen to ask for it
 * opens the listener; later screens share it and get the last result
 * synchronously on their first render. When nobody is using it any more the
 * listener stays open for LINGER_MS, so going back to a page is instant.
 *
 * Everything is dropped when the signed-in user changes. A cashier and an admin
 * share the same tablet, and cost prices or the user list must not carry over.
 */

export interface LiveResult<T> {
  /** The latest result, or undefined when nothing has arrived yet. */
  data: T | undefined;
  /** True until this query's first result (or error) arrives. */
  loading: boolean;
}

type Open<T> = (emit: (value: T) => void, fail: (err: FirestoreError) => void) => Unsubscribe;

interface Snapshot {
  data: unknown;
  loading: boolean;
}

interface Entry {
  key: string;
  open: Open<unknown>;
  snap: Snapshot;
  listeners: Set<() => void>;
  refs: number;
  unsub: Unsubscribe | null;
  /** A listener the rules refused. Not retried until the user changes. */
  failed: boolean;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * How long an unused listener is kept open. Long enough to cover a cashier
 * stepping into Bills or Customers and back; an idle listener only costs reads
 * when its documents actually change.
 */
const LINGER_MS = 10 * 60_000;

const LOADING: Snapshot = Object.freeze({ data: undefined, loading: true });
const IDLE: Snapshot = Object.freeze({ data: undefined, loading: false });

const entries = new Map<string, Entry>();
let authWatched = false;
let currentUid: string | null = null;

function notify(entry: Entry) {
  for (const listener of entry.listeners) listener();
}

function start(entry: Entry) {
  if (entry.unsub || entry.failed || !auth.currentUser) return;
  entry.unsub = entry.open(
    (value) => {
      entry.snap = { data: value, loading: false };
      notify(entry);
    },
    (err) => {
      // A denied read is expected (a cashier on an admin query); anything else is worth seeing.
      if (err.code !== "permission-denied") console.error(`live query "${entry.key}" failed`, err);
      entry.unsub = null;
      entry.failed = true;
      entry.snap = { data: entry.snap.data, loading: false };
      notify(entry);
    },
  );
}

function stop(entry: Entry) {
  entry.unsub?.();
  entry.unsub = null;
}

/** Started lazily, never at import: the static export prerenders these modules. */
function watchAuth() {
  if (authWatched) return;
  authWatched = true;
  currentUid = auth.currentUser?.uid ?? null;
  onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? null;
    if (uid === currentUid) return;
    currentUid = uid;
    for (const entry of [...entries.values()]) {
      stop(entry);
      entry.failed = false;
      entry.snap = uid ? LOADING : IDLE;
      if (entry.refs === 0) {
        if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
        entries.delete(entry.key);
      } else if (uid) {
        start(entry);
      }
      notify(entry);
    }
  });
}

function subscribe(key: string, open: Open<unknown>, listener: () => void): () => void {
  watchAuth();
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      open,
      snap: auth.currentUser ? LOADING : IDLE,
      listeners: new Set(),
      refs: 0,
      unsub: null,
      failed: false,
      disposeTimer: null,
    };
    entries.set(key, entry);
  }
  const e = entry;
  e.listeners.add(listener);
  e.refs += 1;
  if (e.disposeTimer) {
    clearTimeout(e.disposeTimer);
    e.disposeTimer = null;
  }
  start(e);

  return () => {
    e.listeners.delete(listener);
    e.refs -= 1;
    if (e.refs > 0) return;
    e.disposeTimer = setTimeout(() => {
      if (e.refs > 0 || entries.get(key) !== e) return;
      stop(e);
      entries.delete(key);
    }, LINGER_MS);
  };
}

/**
 * Subscribe to a Firestore query through the shared cache.
 *
 * `key` must name everything that changes the query: collection, filters,
 * range, metadata option. Two calls with the same key share one listener and
 * the first `open` wins. Pass `null` to subscribe to nothing.
 */
export function useLive<T>(key: string | null, open: Open<T>): LiveResult<T> {
  // `open` is only read when `key` changes; the key is what identifies the
  // query, so a new closure with the same key is the same subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sub = useCallback((listener: () => void) => (key === null ? () => {} : subscribe(key, open as Open<unknown>, listener)), [key]);
  const getSnapshot = useCallback(
    () => (key === null ? IDLE : (entries.get(key)?.snap ?? LOADING)),
    [key],
  );
  const getServerSnapshot = useCallback(() => (key === null ? IDLE : LOADING), [key]);
  const snap = useSyncExternalStore(sub, getSnapshot, getServerSnapshot);
  return { data: snap.data as T | undefined, loading: snap.loading };
}
