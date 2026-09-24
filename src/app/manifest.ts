import type { MetadataRoute } from "next";

// A manifest route is dynamic by default; `output: "export"` needs it pinned
// so it lands in out/ as a plain file.
export const dynamic = "force-static";

/**
 * Installing the till as an app is what gives it a stable home on the shop's
 * tablet — full screen, its own icon, and no address bar to reload by accident
 * during an outage. The offline behaviour itself comes from the service worker
 * (scripts/generate-sw.mjs), not from this file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chicken Farm POS",
    short_name: "Farm POS",
    description: "Farm POS for a chicken farm — bills, stock and credit, online or off.",
    start_url: "/",
    display: "standalone",
    background_color: "#fdf8ef",
    theme_color: "#d97706",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
