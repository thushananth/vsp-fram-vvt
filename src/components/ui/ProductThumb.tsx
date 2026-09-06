/**
 * A product's photo wherever it is shown — the billing grid, the stock list.
 * Falls back to the first letter of the name, so a shop that hasn't taken
 * photos yet still gets an even, scannable grid rather than ragged blanks.
 */
export default function ProductThumb({
  name,
  imageUrl,
  size = "md",
  /** Corner rounding, so a thumb inside an already-clipped card can sit square. */
  shape = "rounded-xl",
}: {
  name: string;
  imageUrl: string | null;
  size?: "sm" | "md";
  shape?: string;
}) {
  const box = `${size === "sm" ? "h-11 w-11 text-sm" : "h-full w-full text-xl"} ${shape}`;

  if (imageUrl) {
    return (
      // A plain <img>: next/image needs a server to optimise through, and this
      // is a static export pulling from Firebase Storage.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className={`${box} shrink-0 bg-ground object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center bg-ground font-extrabold text-muted-2`}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
