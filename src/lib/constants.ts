// Product categories — shared between Billing's filter chips and Stock's
// "New item" form so the two never drift apart.
export const PRODUCT_CATEGORIES = ["Whole Chicken", "Chicken Parts", "Eggs", "Feed", "Other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
