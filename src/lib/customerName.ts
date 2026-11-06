"use client";

import { useAuth } from "@/lib/auth";
import { isNumberName } from "@/lib/firestore/customers";

export const WALK_IN_LABEL = "Walk-in customer";

/**
 * A walk-in saved under their number carries that number as their name. Cashiers
 * must not see it, so this shows "Walk-in customer" instead; admins see the real name.
 */
export function useCustomerLabel(): { isAdmin: boolean; label: (name: string | null | undefined) => string } {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  return {
    isAdmin,
    label: (name) => {
      const n = name ?? "";
      return !isAdmin && isNumberName(n) ? WALK_IN_LABEL : n;
    },
  };
}
