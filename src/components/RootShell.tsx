"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { startAppCheck } from "@/lib/firebase";
import { AuthProvider } from "@/lib/auth";
import AuthGate from "@/components/AuthGate";
import DeviceGate from "@/components/DeviceGate";
import AppShell from "@/components/AppShell";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export default function RootShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  useEffect(() => {
    startAppCheck();
  }, []);

  return (
    <AuthProvider>
      <ServiceWorkerRegistrar />
      {isLogin ? (
        children
      ) : (
        <AuthGate>
          <DeviceGate>
            <AppShell>{children}</AppShell>
          </DeviceGate>
        </AuthGate>
      )}
    </AuthProvider>
  );
}
