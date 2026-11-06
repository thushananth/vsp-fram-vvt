"use client";

import { useLinkStatus } from "next/link";

/**
 * Instant feedback for a nav tap whose route isn't ready yet. Without it the
 * active highlight only moves once the new page has rendered, so on a slow
 * tablet a tap looks ignored and the cashier taps again.
 *
 * Render it inside a `<Link>`. While that link is pending it tints the tapped
 * item and runs a thin progress bar along the top of the screen. Both appear
 * only after ~120ms (see .nav-pending in globals.css), so a navigation that is
 * already prefetched never flickers.
 */
export default function NavPending({ tone }: { tone: "dark" | "light" }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span
        aria-hidden
        className={`nav-pending pointer-events-none absolute inset-0 rounded-[inherit] ${
          tone === "dark" ? "bg-white/[0.08]" : "bg-accent/[0.07]"
        } ${pending ? "is-pending" : ""}`}
      />
      {pending && <span aria-hidden className="route-progress" />}
    </>
  );
}
