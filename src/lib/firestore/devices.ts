"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import type { DeviceDetails } from "@/lib/device";

export type DeviceStatus = "pending" | "approved" | "blocked";

export interface DeviceApproval {
  deviceId: string;
  status: DeviceStatus;
  browser: string;
  os: string;
  platform: string;
  userAgent: string;
  screen: string;
  timezone: string;
  language: string;
  fingerprint: string;
  ip: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastUserName: string;
  lastUserEmail: string;
  users: string[];
  approvedAt: number | null;
  approvedByName: string;
  approvedVia: string;
  blockedAt: number | null;
  blockedByName: string;
  codeMailedAt: number | null;
  mailedToCount: number;
  lastMailError: string | null;
}

function toDevice(id: string, data: Record<string, unknown> | undefined): DeviceApproval {
  const d = data ?? {};
  const str = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : "");
  const num = (key: string) => (typeof d[key] === "number" ? (d[key] as number) : null);

  return {
    deviceId: id,
    status: d.status === "approved" ? "approved" : d.status === "blocked" ? "blocked" : "pending",
    browser: str("browser"),
    os: str("os"),
    platform: str("platform"),
    userAgent: str("userAgent"),
    screen: str("screen"),
    timezone: str("timezone"),
    language: str("language"),
    fingerprint: str("fingerprint"),
    ip: str("ip"),
    firstSeenAt: num("firstSeenAt") ?? 0,
    lastSeenAt: num("lastSeenAt") ?? 0,
    lastUserName: str("lastUserName"),
    lastUserEmail: str("lastUserEmail"),
    users: Array.isArray(d.users) ? (d.users as string[]) : [],
    approvedAt: num("approvedAt"),
    approvedByName: str("approvedByName"),
    approvedVia: str("approvedVia"),
    blockedAt: num("blockedAt"),
    blockedByName: str("blockedByName"),
    codeMailedAt: num("codeMailedAt"),
    mailedToCount: num("mailedToCount") ?? 0,
    lastMailError: str("lastMailError") || null,
  };
}

/**
 * Live status of one device. `fromCache` matters: offline this is whatever
 * IndexedDB last saw, which is deliberate — a till mid-shift keeps working —
 * but it means a block only bites the next time the device is online.
 */
export function useDeviceApproval(
  deviceId: string | null,
  /** Bump to re-attach after registering — a listener that was denied while
   *  the device doc didn't list this user can't recover on its own. */
  version = 0,
): {
  device: DeviceApproval | null;
  loading: boolean;
  fromCache: boolean;
  denied: boolean;
} {
  const [device, setDevice] = useState<DeviceApproval | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!deviceId) return;
    return onSnapshot(
      doc(db, "deviceApprovals", deviceId),
      (snap) => {
        setDevice(snap.exists() ? toDevice(snap.id, snap.data()) : null);
        setFromCache(snap.metadata.fromCache);
        setDenied(false);
        setLoading(false);
      },
      () => {
        // Rules deny reads of a device this user has never been seen on; the
        // callable stays authoritative in that case.
        setDenied(true);
        setLoading(false);
      },
    );
  }, [deviceId, version]);

  return { device, loading, fromCache, denied };
}

/** Every registered device — the admin Devices screen. */
export function useDevices(): { devices: DeviceApproval[]; loading: boolean } {
  const [devices, setDevices] = useState<DeviceApproval[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "deviceApprovals"), orderBy("lastSeenAt", "desc"));
    return onSnapshot(
      q,
      (snap) => {
        setDevices(snap.docs.map((d) => toDevice(d.id, d.data())));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { devices, loading };
}

export const requestDeviceApproval = httpsCallable<
  { deviceId: string; details: DeviceDetails },
  { status: DeviceStatus; reference: string; mailedCount: number }
>(functions, "requestDeviceApproval");

export const verifyDeviceCode = httpsCallable<{ deviceId: string; code: string }, { ok: true }>(
  functions,
  "verifyDeviceCode",
);

export const setDeviceStatus = httpsCallable<
  { deviceId: string; status: DeviceStatus; details?: DeviceDetails },
  { ok: true }
>(functions, "setDeviceStatus");

export const removeDevice = httpsCallable<{ deviceId: string }, { ok: true }>(
  functions,
  "removeDevice",
);
