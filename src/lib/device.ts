"use client";

/**
 * This browser's identity for the new-device approval flow. The id is a random
 * UUID kept in localStorage: clearing site data makes the browser look new
 * again, which means a *blocked* device can come back as *pending* — it still
 * can't get in without a code or an admin, but the fingerprint below lets the
 * Devices screen spot that it is the same machine.
 */

const DEVICE_ID_KEY = "bakeshop.deviceId";

export interface DeviceDetails {
  browser: string;
  os: string;
  platform: string;
  userAgent: string;
  screen: string;
  timezone: string;
  language: string;
  fingerprint: string;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Stable per-browser id. Returns null on the server (static export prerender). */
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = randomId();
    window.localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode with storage blocked — fall back to a per-session id so the
    // gate still works; it just asks for a code again next time.
    return randomId();
  }
}

/** Short, human-readable handle shown on screen and in the admin email. */
export function deviceReference(deviceId: string): string {
  return deviceId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown browser";
}

function detectOS(ua: string): string {
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}

/** FNV-1a — a stable short hash, not a security primitive. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function collectDeviceDetails(): DeviceDetails {
  const ua = navigator.userAgent ?? "";
  const screenSize =
    typeof window !== "undefined" && window.screen
      ? `${window.screen.width}×${window.screen.height}`
      : "";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const language = navigator.language ?? "";
  const platform = (navigator as Navigator & { platform?: string }).platform ?? "";

  return {
    browser: detectBrowser(ua),
    os: detectOS(ua),
    platform,
    userAgent: ua.slice(0, 400),
    screen: screenSize,
    timezone,
    language,
    // Survives a localStorage wipe, so the Devices screen can point out that a
    // "new" device looks exactly like one that was blocked earlier.
    fingerprint: shortHash([ua, platform, screenSize, timezone, language].join("|")),
  };
}

/** One-line label for lists: "Chrome on Windows 10/11". */
export function deviceLabel(details: { browser?: string; os?: string }): string {
  if (!details.browser && !details.os) return "Unknown device";
  return `${details.browser ?? "Unknown browser"} on ${details.os ?? "unknown OS"}`;
}
