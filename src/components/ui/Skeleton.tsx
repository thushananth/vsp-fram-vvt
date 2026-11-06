/**
 * Placeholders shaped like the content they stand in for, used only the first
 * time a screen's data loads in a session. After that the shared live-query
 * cache (lib/firestore/live.ts) answers on the first render and these never
 * show. A grey copy of the layout reads as "almost there"; a spinner or
 * "Loading…" text in an empty page reads as stuck.
 *
 * They fade in after a short delay, so a load that finishes quickly shows nothing at all.
 */

function Bar({ className = "" }: { className?: string }) {
  return <span className={`skeleton block rounded-md ${className}`} />;
}

/** Rows like a bill, customer or payment list. */
export function SkeletonRows({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="skeleton-in mt-3 flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-3.5">
          <span className="skeleton h-10 w-10 shrink-0 rounded-xl" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <Bar className="h-3.5 w-2/5" />
            <Bar className="h-3 w-1/4" />
          </span>
          <Bar className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Product tiles on the billing grid. */
export function SkeletonTiles({ tiles = 12 }: { tiles?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading products"
      className="skeleton-in grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
    >
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="flex min-h-[112px] flex-col gap-2.5 rounded-2xl bg-surface p-3">
          <span className="skeleton h-10 w-10 rounded-xl" />
          <Bar className="h-3.5 w-4/5" />
          <Bar className="mt-auto h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}
