"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getKnownEmails } from "@/lib/emailHistory";
import Splash from "@/components/Splash";
import BrandMark from "@/components/BrandMark";

export default function LoginPage() {
  const { user, profile, loading, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [knownEmails, setKnownEmails] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setKnownEmails(getKnownEmails());
  }, []);

  // Admins land on the Dashboard — the shop-wide view they actually want first
  // thing; cashiers land on Billing, the everyday screen. Waiting for `loading`
  // to clear (not just `user`) matters: it only turns false once the profile
  // itself has resolved, so the role is known before this ever fires.
  useEffect(() => {
    if (!loading && user) router.replace(profile?.role === "admin" ? "/dashboard" : "/");
  }, [loading, user, profile, router]);

  if (loading) return <Splash />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      // The redirect above fires once the profile (and so the role) is known;
      // this submit handler doesn't have to duplicate that decision.
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === "auth/invalid-credential" || code === "auth/wrong-password"
          ? "Wrong email or password"
          : code === "auth/user-not-found"
            ? "No account with that email"
            : code === "auth/too-many-requests"
              ? "Too many attempts — try again shortly"
              : "Couldn't sign in. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-ink relative flex min-h-screen flex-col items-center justify-center px-4 py-12 text-white">
      {/* Same accent light as the splash, so sign-in reads as the same product. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[110px]"
      />

      <div className="relative mb-8 flex flex-col items-center">
        <BrandMark size="md" />
        <h1 className="mt-4 text-xl font-extrabold tracking-tight">Chicken Farm POS</h1>
        <p className="mt-1 text-sm font-medium text-white/45">Sign in to open the shop</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="relative flex w-full max-w-sm flex-col gap-3.5 rounded-3xl border border-white/10 bg-surface p-6 text-ink shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
      >
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Email
          <input
            required
            type="email"
            list="known-emails"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@chickenfarm.com"
            className="rounded-xl border border-border bg-ground px-4 py-3 text-base font-normal outline-none transition-colors focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
          />
          {/* Suggestions come from emails used to sign in on this device
              before — not fetched from Firebase, which can't list users
              client-side. */}
          <datalist id="known-emails">
            {knownEmails.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-border bg-ground px-4 py-3 text-base font-normal outline-none transition-colors focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/10"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-sm font-semibold text-danger"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 min-h-[52px] rounded-2xl bg-accent text-base font-bold text-white shadow-[0_10px_24px_-10px_rgba(37,99,235,0.9)] transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:shadow-none"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <span className="relative mt-8 text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">
        Powered by 5XCODES
      </span>
    </div>
  );
}
