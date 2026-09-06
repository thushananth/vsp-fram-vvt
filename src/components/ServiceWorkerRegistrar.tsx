"use client";

import { useEffect } from "react";

/**
 * Registers the generated service worker (see scripts/generate-sw.mjs), which
 * is what lets the till open at all with no connection. Nothing renders.
 *
 * Dev has no sw.js — it is written by the build — so registration is skipped
 * there rather than logging a 404 on every reload.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("service worker registration failed", err);
    });
  }, []);

  return null;
}
