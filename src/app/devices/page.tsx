"use client";

import { useMemo, useState } from "react";
import { useAdminGate } from "@/components/AdminGate";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useStoreSettings } from "@/lib/firestore/settings";
import {
  removeDevice,
  setDeviceStatus,
  useDevices,
  type DeviceApproval,
  type DeviceStatus,
} from "@/lib/firestore/devices";
import { deviceLabel, deviceReference, getDeviceId } from "@/lib/device";
import { dateAndTime } from "@/lib/format";

const FILTERS = ["Pending", "Approved", "Blocked", "All"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_STYLE: Record<DeviceStatus, string> = {
  pending: "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  blocked: "bg-danger/10 text-danger",
};

export default function DevicesPage() {
  const gate = useAdminGate("Devices", "Approving a browser to open the till stays with admins.");
  const { devices, loading } = useDevices();
  const { settings } = useStoreSettings();
  const [filter, setFilter] = useState<Filter>("Pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState<string | null>(null);

  const [thisDeviceId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getDeviceId(),
  );

  const filtered = useMemo(() => {
    if (filter === "All") return devices;
    return devices.filter((d) => d.status === filter.toLowerCase());
  }, [devices, filter]);

  // Look the selection up in the *full* list: approving a device drops it out
  // of the Pending filter, and the detail pane must keep showing that device
  // rather than sliding a different one under the Approve/Block/Forget buttons.
  const selected =
    (selectedId ? devices.find((d) => d.deviceId === selectedId) : null) ?? filtered[0] ?? null;
  const pendingCount = devices.filter((d) => d.status === "pending").length;

  // A "new" device whose fingerprint matches a blocked one is the same machine
  // with its site data cleared — worth saying out loud before approving it.
  const blockedFingerprints = useMemo(
    () =>
      new Set(
        devices.filter((d) => d.status === "blocked" && d.fingerprint).map((d) => d.fingerprint),
      ),
    [devices],
  );


  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }


  // Denied by default until the profile says otherwise.
  if (gate) return gate;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-4 pb-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Devices</h1>
          <p className="text-sm font-medium text-muted">
            {devices.length} known · {pendingCount} waiting for approval
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-[#e9edf4] p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setSelectedId(null);
              }}
              className={`min-h-[40px] rounded-lg px-3 text-[13px] font-bold ${
                filter === f ? "bg-white shadow-sm" : "text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!settings.deviceVerification && (
        <p className="rounded-2xl border border-warning/30 bg-warning/5 px-4 py-3 text-xs font-semibold leading-relaxed text-warning">
          Device verification is off — every browser can open the till regardless of what is listed
          here. Turn it on in Settings → Security.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm font-semibold text-danger"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-muted">Loading devices…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-muted">No {filter.toLowerCase()} devices.</p>
      ) : (
        <div className="flex flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex flex-col gap-2 lg:w-[340px] lg:shrink-0">
            {filtered.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => setSelectedId(d.deviceId)}
                className={`flex items-center gap-2.5 rounded-2xl border bg-surface px-3.5 py-3 text-left ${
                  selected?.deviceId === d.deviceId ? "border-accent" : "border-border"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{deviceLabel(d)}</div>
                  <div className="tabular-nums text-xs font-medium text-muted">
                    {deviceReference(d.deviceId)} · {d.lastUserName || "—"}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[d.status]}`}
                >
                  {d.status}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <DeviceDetail
              device={selected}
              busy={busy}
              isThisDevice={selected.deviceId === thisDeviceId}
              looksLikeBlocked={
                selected.status !== "blocked" &&
                !!selected.fingerprint &&
                blockedFingerprints.has(selected.fingerprint)
              }
              onApprove={() =>
                act(() => setDeviceStatus({ deviceId: selected.deviceId, status: "approved" }))
              }
              onBlock={() =>
                act(() => setDeviceStatus({ deviceId: selected.deviceId, status: "blocked" }))
              }
              confirmingForget={confirmForget === selected.deviceId}
              onConfirmForget={() => setConfirmForget(selected.deviceId)}
              onRemove={() => {
                setConfirmForget(null);
                void act(() => removeDevice({ deviceId: selected.deviceId }));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-[#f4f7fb] py-2">
      <div className="w-32 shrink-0 text-xs font-semibold text-muted">{label}</div>
      <div className="min-w-0 flex-1 break-words text-[13px] font-semibold">{value || "—"}</div>
    </div>
  );
}

function DeviceDetail({
  device,
  busy,
  isThisDevice,
  looksLikeBlocked,
  confirmingForget,
  onApprove,
  onBlock,
  onConfirmForget,
  onRemove,
}: {
  device: DeviceApproval;
  busy: boolean;
  isThisDevice: boolean;
  looksLikeBlocked: boolean;
  confirmingForget: boolean;
  onApprove: () => void;
  onBlock: () => void;
  onConfirmForget: () => void;
  onRemove: () => void;
}) {
  const icon =
    device.status === "approved" ? (
      <ShieldCheck className="h-5 w-5 text-success" />
    ) : device.status === "blocked" ? (
      <ShieldX className="h-5 w-5 text-danger" />
    ) : (
      <ShieldAlert className="h-5 w-5 text-warning" />
    );

  return (
    <div className="flex-1 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        {icon}
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-2">
          {device.status}
          {isThisDevice && " · this device"}
        </div>
      </div>
      <div className="mt-0.5 text-xl font-extrabold">{deviceLabel(device)}</div>
      <div className="tabular-nums text-xs font-medium text-muted">
        Reference {deviceReference(device.deviceId)}
      </div>

      {looksLikeBlocked && (
        <p className="mt-3 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-xs font-semibold leading-relaxed text-danger">
          Same hardware fingerprint as a device you blocked. Clearing site data makes a blocked
          browser look new — approve this one only if you know who is asking.
        </p>
      )}

      <div className="my-3.5 h-px bg-[#eef2f7]" />

      <Field
        label="Last used by"
        value={
          device.lastUserEmail
            ? `${device.lastUserName} (${device.lastUserEmail})`
            : device.lastUserName
        }
      />
      <Field label="First seen" value={dateAndTime(device.firstSeenAt)} />
      <Field label="Last seen" value={dateAndTime(device.lastSeenAt)} />
      <Field label="IP address" value={device.ip} />
      <Field label="Screen" value={device.screen} />
      <Field label="Time zone" value={device.timezone} />
      <Field label="Language" value={device.language} />
      <Field label="Fingerprint" value={device.fingerprint} />
      <Field label="User agent" value={device.userAgent} />
      {device.status === "approved" && (
        <Field
          label="Approved"
          value={`${dateAndTime(device.approvedAt ?? 0)}${
            device.approvedVia === "code"
              ? " · by code"
              : device.approvedByName
                ? ` · by ${device.approvedByName}`
                : ""
          }`}
        />
      )}
      {device.status === "blocked" && (
        <Field
          label="Blocked"
          value={`${dateAndTime(device.blockedAt ?? 0)}${
            device.blockedByName ? ` · by ${device.blockedByName}` : ""
          }`}
        />
      )}
      {device.codeMailedAt && (
        <Field
          label="Code emailed"
          value={`${dateAndTime(device.codeMailedAt)} · ${device.mailedToCount} admin(s)`}
        />
      )}
      {device.lastMailError && <Field label="Mail error" value={device.lastMailError} />}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          disabled={busy || device.status === "approved"}
          onClick={onApprove}
          className="min-h-[52px] flex-1 rounded-xl bg-success text-[15px] font-bold text-white disabled:opacity-40"
        >
          {device.status === "approved" ? "Approved" : "Approve"}
        </button>
        <button
          disabled={busy || device.status === "blocked"}
          onClick={onBlock}
          className="min-h-[52px] flex-1 rounded-xl border border-danger/40 text-[15px] font-bold text-danger disabled:opacity-40"
        >
          {device.status === "blocked" ? "Blocked" : "Block"}
        </button>
        <button
          disabled={busy}
          onClick={confirmingForget ? onRemove : onConfirmForget}
          className={`min-h-[52px] rounded-xl border px-4 text-[15px] font-bold disabled:opacity-40 ${
            confirmingForget ? "border-danger bg-danger/10 text-danger" : "border-border text-muted"
          }`}
        >
          {confirmingForget ? "Tap to confirm" : "Forget"}
        </button>
      </div>
      <p className="mt-3 text-xs font-medium leading-relaxed text-muted-2">
        Blocking takes effect the next time this device is online — a till already offline keeps
        working on its last known status until it reconnects.
      </p>
    </div>
  );
}
