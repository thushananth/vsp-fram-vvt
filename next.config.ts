import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown under the user's name in the sidebar, so a till can be checked
  // against what was last deployed.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  // Static export for Firebase Hosting — the app talks to Firestore
  // directly client-side (offline persistence covers weak-wifi shops).
  output: "export",
};

export default nextConfig;
