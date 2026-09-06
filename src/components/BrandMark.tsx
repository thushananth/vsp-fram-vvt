/**
 * The one Bakery POS logo mark. Splash, login and the sidebar all render this,
 * so the first thing a cashier sees is the same mark in all three places —
 * change it here and it changes everywhere.
 */

const SIZES = {
  sm: { box: "h-9 w-9 rounded-[11px]", type: "text-[15px]", sheen: "rounded-[11px]" },
  md: { box: "h-14 w-14 rounded-[18px]", type: "text-2xl", sheen: "rounded-[18px]" },
  lg: { box: "h-20 w-20 rounded-[26px]", type: "text-[34px]", sheen: "rounded-[26px]" },
} as const;

export default function BrandMark({
  size = "md",
  className = "",
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];

  return (
    <span
      aria-hidden
      className={`relative isolate flex shrink-0 items-center justify-center overflow-hidden bg-[linear-gradient(150deg,#4C8DFF_0%,#2563EB_45%,#1D4ED8_100%)] shadow-[0_10px_28px_-10px_rgba(37,99,235,0.9)] ring-1 ring-inset ring-white/25 ${s.box} ${className}`}
    >
      {/* A single diagonal sheen keeps the badge from reading as flat fill. */}
      <span
        className={`pointer-events-none absolute inset-0 bg-[linear-gradient(150deg,rgba(255,255,255,0.28)_0%,rgba(255,255,255,0)_52%)] ${s.sheen}`}
      />
      <span className={`relative font-extrabold leading-none tracking-tight text-white ${s.type}`}>
        B
      </span>
    </span>
  );
}
