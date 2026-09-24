"use client";

// Locally-remembered emails for the login dropdown. Deliberately NOT backed
// by Firebase — client code can't list Auth users, and this is just a
// convenience for whoever has signed in on this device before.
const STORAGE_KEY = "chickenfarm.knownEmails";
const MAX_REMEMBERED = 8;

export function getKnownEmails(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function rememberEmail(email: string) {
  if (typeof window === "undefined") return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const existing = getKnownEmails().filter((e) => e !== normalized);
  const next = [normalized, ...existing].slice(0, MAX_REMEMBERED);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function forgetEmail(email: string) {
  if (typeof window === "undefined") return;
  const next = getKnownEmails().filter((e) => e !== email.trim().toLowerCase());
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
