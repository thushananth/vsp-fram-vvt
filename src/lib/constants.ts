// Swatches a category can wear on Billing's chips and the Products screen.
// Tuned to read on both the white surface and as a soft tint behind text.
export const CATEGORY_COLORS = [
  "#D97706", // amber — the brand
  "#DC2626", // red
  "#16A34A", // green
  "#2563EB", // blue
  "#9333EA", // purple
  "#DB2777", // pink
  "#0891B2", // teal
  "#64748B", // slate
] as const;

/** Units a product can be sold in — printed beside the quantity on receipts. */
export const PRODUCT_UNITS = ["kg", "pcs", "g", "L", "pkt"] as const;

// Letterhead on receipts and every PDF — matches the old app's printed bills.
export const SHOP_DETAILS = {
  name: "VSP FARM",
  address: "Theniyambai, Valvettithurai, Sri Lanka",
  phone: "077 023 8493",
} as const;
