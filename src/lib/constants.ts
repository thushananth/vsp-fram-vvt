// Product categories — shared between Billing's filter chips and Stock's
// "New item" form so the two never drift apart.
export const PRODUCT_CATEGORIES = ["Whole Chicken", "Chicken Parts", "Eggs", "Feed", "Other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// Letterhead on printed reports (Reports → Customers → PDF), matching the
// customer statements the shop already sends out.
export const SHOP_DETAILS = {
  name: "VSP FARM",
  address: "Theniyambai, Valvettithurai, Sri Lanka",
  phone: "077 023 8493",
} as const;
