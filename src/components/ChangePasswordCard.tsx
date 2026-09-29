"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";

const MIN_LENGTH = 6; // Firebase Auth's own minimum.

function friendlyError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Current password is wrong.";
    case "auth/weak-password":
      return `New password is too weak — use at least ${MIN_LENGTH} characters.`;
    case "auth/too-many-requests":
      return "Too many attempts — wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "No connection — the password was not changed. Try again when online.";
    case "auth/requires-recent-login":
      return "Please sign out and sign in again, then change the password.";
    default:
      return fallback;
  }
}

/**
 * The signed-in user's own password. Firebase only lets a password change
 * through on a fresh sign-in, so the current password is checked first
 * (reauthenticate) — which is also what stops someone at an unattended,
 * logged-in till from changing it.
 *
 * Admin-only. Settings already sits behind the admin gate; this check keeps it
 * that way if the card is ever placed anywhere else.
 */
export default function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { profile } = useAuth();

  const mismatch = confirm !== "" && next !== confirm;

  if (profile?.role !== "admin") return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    const user = auth.currentUser;
    if (!user?.email) {
      setError("You need to be signed in with an email account to change the password.");
      return;
    }
    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current one.");
      return;
    }

    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      const { code, message } = err as { code?: string; message?: string };
      setError(friendlyError(code, message ?? "Could not change the password."));
    } finally {
      setSaving(false);
    }
  }

  const field =
    "h-[46px] rounded-xl border border-border bg-ground px-3 text-base font-normal outline-none focus:border-accent";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5"
    >
      <div>
        <div className="text-[15px] font-bold">Change password</div>
        <div className="mt-0.5 text-xs font-medium leading-relaxed text-muted">
          For the account you are signed in with
          {auth.currentUser?.email ? ` (${auth.currentUser.email})` : ""}. Other devices stay
          signed in.
        </div>
      </div>

      {/* Lets password managers file the new password under the right account. */}
      <input
        type="email"
        autoComplete="username"
        value={auth.currentUser?.email ?? ""}
        readOnly
        hidden
      />

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={field}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${field} ${mismatch ? "border-danger" : ""}`}
          />
        </label>
      </div>
      {mismatch && <p className="text-xs font-semibold text-danger">Passwords don&apos;t match.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving || !current || !next || !confirm}
          className="min-h-[48px] rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Changing…" : "Change password"}
        </button>
        {done && <span className="text-sm font-semibold text-success">Password changed.</span>}
        {error && <span className="text-sm font-semibold text-danger">{error}</span>}
      </div>
    </form>
  );
}
