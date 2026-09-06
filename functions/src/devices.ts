import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as nodemailer from "nodemailer";
import { db } from "./db";

/**
 * New-device approval. A browser that has never been approved cannot reach the
 * app: on sign-in (and on every load — see DeviceGate) the client registers its
 * device here, every admin is emailed a 6-digit code plus the device details,
 * and the till stays locked until someone types that code or an admin approves
 * the device from the Devices screen.
 */

const CODE_TTL_MS = 15 * 60 * 1000; // a code is good for 15 minutes
const MAIL_COOLDOWN_MS = 10 * 60 * 1000; // don't re-mail admins more often than this
const MAX_ATTEMPTS = 5;

export type DeviceStatus = "pending" | "approved" | "blocked";

interface DeviceDetails {
  browser?: string;
  os?: string;
  platform?: string;
  userAgent?: string;
  screen?: string;
  timezone?: string;
  language?: string;
  fingerprint?: string;
}

interface RequestDeviceApprovalData {
  deviceId: string;
  details?: DeviceDetails;
}

function reference(deviceId: string): string {
  return deviceId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function sixDigitCode(): string {
  // crypto.randomInt would need the callback form here; this is plenty for a
  // 15-minute, 5-attempt code that is also emailed out of band.
  return String(Math.floor(100000 + Math.random() * 900000));
}

function clientIp(request: CallableRequest): string {
  const raw = request.rawRequest;
  const forwarded = raw?.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (first?.split(",")[0] ?? raw?.ip ?? "unknown").trim();
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

const MAIL_FROM = process.env.SMTP_FROM ?? '"Bakery POS" <noreply@5xcodes.com>';

/** Every active admin's email — the people who can let a new device in. */
async function adminEmails(): Promise<string[]> {
  // Single-field query, then filter in JS: avoids needing a composite index.
  const snap = await db.collection("users").where("role", "==", "admin").get();
  return snap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => d.data().email as string | undefined)
    .filter((email): email is string => !!email);
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#64748b;width:150px;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#0f1629;font-weight:600;">${value || "—"}</td>
  </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function approvalEmailHTML(params: {
  code: string;
  ref: string;
  userName: string;
  userEmail: string;
  details: DeviceDetails;
  ip: string;
  when: string;
}): string {
  const { code, ref, userName, userEmail, details, ip, when } = params;
  const d = (value?: string) => escapeHtml(value ?? "");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(15,22,41,0.08);">
        <tr>
          <td style="padding:24px 32px;background:#0f1629;">
            <p style="margin:0;font-size:18px;font-weight:bold;color:#ffffff;">Bakery POS — new device sign-in</p>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.6);">A device that has not been approved before is trying to open the till.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 8px;">
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Verification code</p>
            <p style="margin:0;font-size:34px;letter-spacing:8px;font-weight:bold;color:#2563eb;">${code}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Valid for 15 minutes. Give it only to someone you expect to be signing in — or approve the device yourself from Settings &rarr; Devices.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef2f7;">
              ${row("Device reference", d(ref))}
              ${row("Signed in as", `${d(userName)} (${d(userEmail)})`)}
              ${row("Browser", d(details.browser))}
              ${row("Operating system", d(details.os))}
              ${row("Platform", d(details.platform))}
              ${row("Screen", d(details.screen))}
              ${row("Time zone", d(details.timezone))}
              ${row("Language", d(details.language))}
              ${row("IP address", d(ip))}
              ${row("Requested at", d(when))}
            </table>
            <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;word-break:break-all;">${d(details.userAgent)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;background:#fafbfc;border-top:1px solid #eef2f7;">
            <p style="margin:0;font-size:12px;color:#64748b;">Didn't expect this? Block the device from Settings &rarr; Devices — it will be locked out the next time it is online.</p>
            <p style="margin:10px 0 0;font-size:11px;color:#bbb;">&copy; ${new Date().getFullYear()} 5XCODES Pvt Ltd</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Called by the client on every load while device verification is on. Returns
 * the device's status; for an unknown device it also creates the pending
 * request and emails the code to every admin (at most once per cooldown).
 */
export const requestDeviceApproval = onCall<RequestDeviceApprovalData>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const { deviceId, details = {} } = request.data ?? {};
  if (!deviceId || typeof deviceId !== "string" || deviceId.length > 100) {
    throw new HttpsError("invalid-argument", "A deviceId is required");
  }

  const uid = request.auth.uid;
  const profile = (await db.doc(`users/${uid}`).get()).data() ?? {};
  const userName = (profile.name as string) ?? request.auth.token.name ?? "Unknown user";
  const userEmail = (profile.email as string) ?? request.auth.token.email ?? "";

  const deviceRef = db.doc(`deviceApprovals/${deviceId}`);
  const existing = await deviceRef.get();
  const now = Date.now();

  const seen = {
    lastSeenAt: now,
    lastUserId: uid,
    lastUserName: userName,
    lastUserEmail: userEmail,
    users: FieldValue.arrayUnion(uid),
    ip: clientIp(request),
    ...details,
  };

  if (existing.exists) {
    const status = (existing.data()?.status as DeviceStatus) ?? "pending";
    await deviceRef.set(seen, { merge: true });
    if (status !== "pending") {
      return { status, reference: reference(deviceId), mailedCount: 0 };
    }
  } else {
    await deviceRef.set(
      {
        deviceId,
        status: "pending" as DeviceStatus,
        firstSeenAt: now,
        ...seen,
      },
      { merge: true },
    );
  }

  // Still pending — issue (or reuse) a code and tell the admins about it.
  const codeRef = db.doc(`deviceCodes/${deviceId}`);
  const codeSnap = await codeRef.get();
  const codeData = codeSnap.data();
  // A code is only good for the person it was issued to: it reaches them via an
  // admin, so it must not double as a token anyone signed in can spend.
  const codeValid =
    !!codeData &&
    typeof codeData.expiresAt === "number" &&
    codeData.expiresAt > now &&
    codeData.issuedFor === uid;

  // Minting is floored at the mail cooldown, so a reload loop can't farm fresh
  // codes (each one resets the attempt counter) or flood the admins' inboxes.
  const lastCreatedAt = (codeData?.createdAt as number) ?? 0;
  if (!codeValid && codeData && now - lastCreatedAt < MAIL_COOLDOWN_MS) {
    return { status: "pending" as DeviceStatus, reference: reference(deviceId), mailedCount: 0 };
  }

  const code = codeValid ? (codeData!.code as string) : sixDigitCode();
  const lastMailedAt = (codeData?.mailedAt as number) ?? 0;
  const shouldMail = !codeValid || now - lastMailedAt > MAIL_COOLDOWN_MS;

  if (!codeValid) {
    await codeRef.set({
      code,
      issuedFor: uid,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      createdAt: now,
    });
  }

  if (!shouldMail) {
    return { status: "pending" as DeviceStatus, reference: reference(deviceId), mailedCount: 0 };
  }

  const recipients = await adminEmails();
  if (recipients.length === 0) {
    await deviceRef.set({ lastMailError: "No active admin has an email address" }, { merge: true });
    return { status: "pending" as DeviceStatus, reference: reference(deviceId), mailedCount: 0 };
  }

  try {
    await getTransporter().sendMail({
      from: MAIL_FROM,
      to: recipients,
      subject: `Bakery POS — approve new device ${reference(deviceId)} (${userName})`,
      html: approvalEmailHTML({
        code,
        ref: reference(deviceId),
        userName,
        userEmail,
        details,
        ip: clientIp(request),
        when: new Date(now).toLocaleString("en-LK", { timeZone: "Asia/Colombo" }),
      }),
    });
    await codeRef.set({ mailedAt: now }, { merge: true });
    await deviceRef.set(
      { codeMailedAt: now, mailedToCount: recipients.length, lastMailError: FieldValue.delete() },
      { merge: true },
    );
    return {
      status: "pending" as DeviceStatus,
      reference: reference(deviceId),
      mailedCount: recipients.length,
    };
  } catch (err) {
    // Mail is best-effort: the request still stands and an admin can approve
    // it from the Devices screen, so never fail the call over a mail error.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[devices] Failed to email admins:", message);
    await deviceRef.set({ lastMailError: message }, { merge: true });
    return { status: "pending" as DeviceStatus, reference: reference(deviceId), mailedCount: 0 };
  }
});

/** The person at the till types the code an admin read out to them. */
export const verifyDeviceCode = onCall<{ deviceId: string; code: string }>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const { deviceId, code } = request.data ?? {};
  if (!deviceId || !code) {
    throw new HttpsError("invalid-argument", "deviceId and code are required");
  }

  const deviceRef = db.doc(`deviceApprovals/${deviceId}`);
  const device = await deviceRef.get();
  if (!device.exists) {
    throw new HttpsError("not-found", "This device hasn't been registered yet");
  }
  if (device.data()?.status === "blocked") {
    throw new HttpsError("permission-denied", "This device is blocked");
  }

  const codeRef = db.doc(`deviceCodes/${deviceId}`);
  const codeSnap = await codeRef.get();
  const data = codeSnap.data();
  const now = Date.now();

  if (!data || typeof data.expiresAt !== "number" || data.expiresAt < now) {
    throw new HttpsError("deadline-exceeded", "That code has expired — request a new one");
  }
  if (((data.attempts as number) ?? 0) >= MAX_ATTEMPTS) {
    throw new HttpsError("resource-exhausted", "Too many wrong codes — request a new one");
  }
  if (data.issuedFor !== request.auth.uid) {
    throw new HttpsError("permission-denied", "That code was issued for a different sign-in");
  }
  if (String(data.code) !== String(code).trim()) {
    await codeRef.set({ attempts: ((data.attempts as number) ?? 0) + 1 }, { merge: true });
    throw new HttpsError("permission-denied", "Wrong code");
  }

  await deviceRef.set(
    {
      status: "approved" as DeviceStatus,
      approvedAt: now,
      approvedBy: request.auth.uid,
      approvedVia: "code",
    },
    { merge: true },
  );
  await codeRef.delete();

  return { ok: true as const };
});

async function requireAdmin(uid: string | undefined) {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const profile = await db.doc(`users/${uid}`).get();
  if (profile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }
  return profile.data() ?? {};
}

/**
 * Admin-only: approve, block or re-pend a device. `details` lets an admin
 * register-and-approve a device that has never called in yet — that is how
 * turning device verification on approves the admin's own browser instead of
 * locking them out of the switch they just flipped.
 */
export const setDeviceStatus = onCall<{
  deviceId: string;
  status: DeviceStatus;
  details?: DeviceDetails;
}>(async (request) => {
  const admin = await requireAdmin(request.auth?.uid);
  const { deviceId, status, details } = request.data ?? {};

  if (!deviceId || (status !== "approved" && status !== "blocked" && status !== "pending")) {
    throw new HttpsError("invalid-argument", "deviceId and a valid status are required");
  }

  const now = Date.now();
  const deviceRef = db.doc(`deviceApprovals/${deviceId}`);
  const existing = await deviceRef.get();

  await deviceRef.set(
    {
      deviceId,
      status,
      ...(existing.exists ? {} : { firstSeenAt: now, lastSeenAt: now }),
      ...(details ?? {}),
      ...(status === "approved"
        ? {
            approvedAt: now,
            approvedBy: request.auth!.uid,
            approvedByName: (admin.name as string) ?? "",
            approvedVia: "admin",
          }
        : {}),
      ...(status === "blocked"
        ? { blockedAt: now, blockedBy: request.auth!.uid, blockedByName: (admin.name as string) ?? "" }
        : {}),
    },
    { merge: true },
  );

  // A decided device has no use for a live code.
  if (status !== "pending") {
    await db.doc(`deviceCodes/${deviceId}`).delete().catch(() => undefined);
  }

  return { ok: true as const };
});

/** Admin-only: forget a device entirely. It becomes "new" again on next use. */
export const removeDevice = onCall<{ deviceId: string }>(async (request) => {
  await requireAdmin(request.auth?.uid);
  const { deviceId } = request.data ?? {};
  if (!deviceId) {
    throw new HttpsError("invalid-argument", "deviceId is required");
  }
  await db.doc(`deviceApprovals/${deviceId}`).delete();
  await db.doc(`deviceCodes/${deviceId}`).delete().catch(() => undefined);
  return { ok: true as const };
});
