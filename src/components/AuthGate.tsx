"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import Splash from "@/components/Splash";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  // Deactivating a user disables their account, but a browser already signed
  // in keeps a valid token for up to an hour — the live profile flag is what
  // ends the session straight away.
  const deactivated = profile?.active === false;

  useEffect(() => {
    if (deactivated) void signOut();
  }, [deactivated, signOut]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user || deactivated) return <Splash />;

  return <>{children}</>;
}
