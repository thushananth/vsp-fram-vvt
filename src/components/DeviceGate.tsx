"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/online";
import { useStoreSettings } from "@/lib/firestore/settings";
import { collectDeviceDetails, deviceReference, getDeviceId } from "@/lib/device";
import {
  requestDeviceApproval,
  useDeviceApproval,
  verifyDeviceCode,
  type DeviceStatus,
} from "@/lib/firestore/devices";
import Splash from "@/components/Splash";
import BrandMark from "@/components/BrandMark";

/**
 * Blocks every screen — not just the login form — until this browser has been
 * approved. It sits inside AuthGate, so typing a URL straight into the address
 * bar lands here too. Enforcement is client-side: Firestore rules still only
 * require a signed-in user, so this stops people, not a determined attacker
 * with the SDK open.
 */
export default function DeviceGate({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const { settings, loading: settingsLoading } = useStoreSettings();
  const online = useOnline();
  const enabled = settings.deviceVerification;

  // Read once, on the client. DeviceGate only mounts after AuthGate resolves,
  // so this never runs during hydration.
  const [deviceId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getDeviceId(),
  );
  const [serverStatus, setServerStatus] = useState<DeviceStatus | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [mailedCount, setMailedCount] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [subVersion, setSubVersion] = useState(0);
  const requestedFor = useRef<string | null>(null);

  const { device, loading: deviceLoading, fromCache } = useDeviceApproval(
    enabled ? deviceId : null,
    subVersion,
  );

  const register = useCallback(async () => {
    if (!deviceId) return;
    setRegistering(true);
    setRegisterError(null);
    try {
      const result = await requestDeviceApproval({
        deviceId,
        details: collectDeviceDetails(),
      });
      setServerStatus(result.data.status);
      setMailedCount(result.data.mailedCount);
      // The doc now exists and lists this user — pick up live decisions.
      setSubVersion((v) => v + 1);
    } catch (err) {
      setRegisterError((err as Error).message);
    } finally {
      setRegistering(false);
    }
  }, [deviceId]);

  // Register once per device+session. The function itself is idempotent and
  // rate-limits the admin email, so a reload can't spam anyone's inbox.
  useEffect(() => {
    if (!enabled || !deviceId || !user || requestedFor.current === deviceId) return;
    requestedFor.current = deviceId;
    void register();
  }, [enabled, deviceId, user, register]);

  const status: DeviceStatus | null = useMemo(() => {
    // The live doc is how an admin's decision reaches a screen that is already
    // open; the callable's answer is how a just-typed code takes effect before
    // the snapshot catches up. Where they disagree, the stricter one wins.
    if (device?.status === "blocked" || serverStatus === "blocked") return "blocked";
    if (device?.status === "approved" || serverStatus === "approved") return "approved";
    return device?.status ?? serverStatus;
  }, [device, serverStatus]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!deviceId) return;
    setVerifying(true);
    setCodeError(null);
    try {
      await verifyDeviceCode({ deviceId, code: code.trim() });
      setServerStatus("approved");
      setCode("");
    } catch (err) {
      setCodeError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  if (!enabled) return <>{children}</>;
  if (settingsLoading || !deviceId) return <Splash />;
  if (status === "approved") return <>{children}</>;
  // No answer yet from either the snapshot or the callable — still deciding.
  if (status === null && (deviceLoading || registering)) return <Splash />;

  const reference = deviceReference(deviceId);

  if (status === "blocked") {
    return (
      <Frame
        icon={<ShieldX className="h-7 w-7 text-danger" />}
        title="This device is blocked"
        body="An admin has blocked this browser from opening the till. Ask an admin to unblock it from Settings → Devices, or sign in on an approved device."
        reference={reference}
      >
        <button
          onClick={() => void signOut()}
          className="min-h-[52px] w-full rounded-2xl border border-white/15 text-[15px] font-bold text-white"
        >
          Sign out
        </button>
      </Frame>
    );
  }

  // Unknown device, and we couldn't reach the server to register it.
  if (status === null) {
    return (
      <Frame
        icon={online ? <ShieldAlert className="h-7 w-7 text-warning" /> : <WifiOff className="h-7 w-7 text-warning" />}
        title={online ? "Couldn't check this device" : "Offline — can't verify this device"}
        body={
          online
            ? "This browser hasn't been approved yet and the check didn't go through. Try again in a moment."
            : "A device that has never been approved has to be verified online at least once. Reconnect and try again."
        }
        reference={reference}
      >
        {registerError && <ErrorNote>{registerError}</ErrorNote>}
        <button
          onClick={() => void register()}
          disabled={registering}
          className="min-h-[52px] w-full rounded-2xl bg-accent text-[15px] font-bold text-white disabled:opacity-50"
        >
          {registering ? "Checking…" : "Try again"}
        </button>
        <button
          onClick={() => void signOut()}
          className="min-h-[44px] w-full text-sm font-semibold text-white/50"
        >
          Sign out
        </button>
      </Frame>
    );
  }

  return (
    <Frame
      icon={<ShieldCheck className="h-7 w-7 text-accent" />}
      title="New device — approval needed"
      body={
        mailedCount === 0
          ? "This browser hasn't been used before. Ask an admin to approve it from Settings → Devices, or to read you the code."
          : "This browser hasn't been used before. Every admin has been emailed a 6-digit code with these device details — type it below, or ask an admin to approve the device from Settings → Devices."
      }
      reference={reference}
    >
      <form onSubmit={handleVerify} className="flex w-full flex-col gap-3">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="000000"
          className="w-full rounded-2xl border border-border bg-surface px-4 py-4 text-center text-2xl font-bold tracking-[0.4em] text-ink outline-none focus:border-accent"
        />
        {codeError && <ErrorNote>{codeError}</ErrorNote>}
        <button
          type="submit"
          disabled={verifying || code.length < 6}
          className="min-h-[52px] w-full rounded-2xl bg-accent text-[15px] font-bold text-white disabled:opacity-50"
        >
          {verifying ? "Checking…" : "Approve this device"}
        </button>
      </form>
      <button
        onClick={() => void register()}
        disabled={registering}
        className="min-h-[44px] w-full text-sm font-semibold text-white/50 disabled:opacity-50"
      >
        {registering ? "Sending…" : "Email the admins again"}
      </button>
      {fromCache && !online && (
        <p className="text-xs font-medium text-warning">
          Showing the last known status — this device is offline.
        </p>
      )}
      <button
        onClick={() => void signOut()}
        className="min-h-[44px] w-full text-sm font-semibold text-white/50"
      >
        Sign out
      </button>
    </Frame>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger/20 bg-danger/10 px-3.5 py-2.5 text-sm font-semibold text-danger"
    >
      {children}
    </p>
  );
}

function Frame({
  icon,
  title,
  body,
  reference,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  reference: string;
  children: React.ReactNode;
}) {
  return (
    <div className="surface-ink relative flex min-h-screen flex-col items-center justify-center px-4 py-12 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[110px]"
      />
      <div className="relative mb-8 flex flex-col items-center">
        <BrandMark size="md" />
        <h1 className="mt-4 text-xl font-extrabold tracking-tight">Bakery POS</h1>
      </div>

      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">{icon}</div>
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
          <p className="mt-1.5 text-sm font-medium leading-relaxed text-white/55">{body}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">
            Device reference
          </div>
          <div className="tabular-nums text-lg font-extrabold tracking-[0.2em]">{reference}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
