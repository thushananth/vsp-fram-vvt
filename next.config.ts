import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for Firebase Hosting — the app talks to Firestore
  // directly client-side (offline persistence covers weak-wifi shops).
  output: "export",
};

export default nextConfig;
