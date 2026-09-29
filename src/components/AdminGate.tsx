"use client";

import { useAuth } from "@/lib/auth";
import Splash from "@/components/Splash";
import { usePermissions, type CashierPermissions } from "@/lib/firestore/permissions";

/**
 * The admin-only screens all guarded themselves with
 * `if (profile && profile.role !== "admin")`, which fails open: `profile` is
 * null on every cold load until the users doc arrives, so the guard was skipped
 * and the page rendered its contents first — cost prices, user emails, device
 * details — before flipping to the refusal. Marking a route `adminOnly` in the
 * nav only hides the link; typing the URL still gets there.
 *
 * This denies by default and waits for the profile before deciding.
 *
 * Enforcement is client-side, like DeviceGate: Firestore rules are what
 * actually stop a determined reader. This stops people.
 */
export function useAdminGate(what: string, why: string): React.ReactElement | null {
  const { profile, loading } = useAuth();

  if (loading) return <Splash />;
  if (profile?.role !== "admin") {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-extrabold">{what} is admin-only</h1>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">{why}</p>
      </div>
    );
  }
  return null;
}

/**
 * The same deny-by-default gate for a screen an admin can open up to cashiers
 * with one of the Settings → cashier permission toggles.
 */
export function usePermissionGate(
  flag: keyof CashierPermissions,
  what: string,
  why: string,
): React.ReactElement | null {
  const { profile, loading } = useAuth();
  const { permissions, loading: permissionsLoading } = usePermissions();

  if (loading || permissionsLoading) return <Splash />;
  if (profile?.role !== "admin" && !permissions[flag]) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-extrabold">{what} is admin-only</h1>
        <p className="mt-1.5 text-sm font-medium leading-relaxed text-muted">{why}</p>
      </div>
    );
  }
  return null;
}
