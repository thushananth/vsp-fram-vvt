import BrandMark from "@/components/BrandMark";

/**
 * Full-screen loading state, shown while Firebase Auth resolves.
 * Rendered by AuthGate and by the login page.
 */
export default function Splash() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="surface-ink fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-white"
    >
      {/* Soft accent light behind the mark — the only thing lifting the ink. */}
      <div
        aria-hidden
        className="animate-glow pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-[62%] rounded-full bg-accent/20 blur-[110px]"
      />

      <div className="relative flex flex-col items-center">
        <BrandMark size="lg" className="animate-rise" />

        <h1
          className="animate-rise mt-7 text-[26px] font-extrabold leading-none tracking-tight"
          style={{ animationDelay: "90ms" }}
        >
          Chicken Farm POS
        </h1>

        <p
          className="animate-rise mt-2.5 text-sm font-medium text-white/45"
          style={{ animationDelay: "160ms" }}
        >
          Getting your shop ready…
        </p>

        <div
          className="animate-rise mt-9 h-[3px] w-[168px] overflow-hidden rounded-full bg-white/10"
          style={{ animationDelay: "230ms" }}
        >
          <div className="animate-sweep h-full w-1/3 rounded-full bg-[linear-gradient(90deg,rgba(59,130,246,0)_0%,#3B82F6_50%,rgba(59,130,246,0)_100%)]" />
        </div>
      </div>

      <span className="absolute bottom-9 text-[10px] font-bold uppercase tracking-[0.2em] text-white/25">
        Powered by 5XCODES
      </span>
    </div>
  );
}
