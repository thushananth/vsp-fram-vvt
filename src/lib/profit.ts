import { lineAmount } from "@/lib/billLines";
import type { Bill, Product } from "@/lib/types";

export interface ProductProfit {
  productId: string;
  name: string;
  product: Product | undefined;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  /** True when any line fell back to the product's *current* cost price. */
  estimated: boolean;
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  profit: number;
  bills: number;
  estimatedLines: number;
}

/**
 * Margin, by product and in total, for the Profit screen and the assistant.
 *
 * Profit is measured line by line against `costPrice` as it was **stamped on
 * the line at the moment of sale**. Reading cost off the product instead would
 * silently re-price last month's margin every time the shop changes what it
 * charges. Bills written before that field existed fall back to the product's
 * current cost and are marked estimated, rather than counted as pure profit.
 */
export function buildProfit(params: {
  bills: Bill[];
  productsById: Map<string, Product>;
  startMs: number;
  endMs: number;
}): { rows: ProductProfit[]; totals: ProfitTotals } {
  const { bills, productsById } = params;
  const byProduct = new Map<string, ProductProfit>();
  let revenue = 0;
  let cost = 0;
  let estimatedLines = 0;

  const inRange = bills.filter(
    (b) => b.status === "paid" && b.createdAt >= params.startMs && b.createdAt < params.endMs,
  );

  for (const bill of inRange) {
    for (const lineItem of bill.lines) {
      const product = productsById.get(lineItem.productId);
      const stamped = lineItem.costPrice;
      const unitCost = stamped ?? product?.costPrice ?? 0;
      const isEstimate = stamped === undefined;
      if (isEstimate) estimatedLines += 1;

      const lineRevenue = lineAmount(lineItem);
      const lineCost = unitCost * lineItem.qty;
      revenue += lineRevenue;
      cost += lineCost;

      const existing = byProduct.get(lineItem.productId);
      if (existing) {
        existing.qty += lineItem.qty;
        existing.revenue += lineRevenue;
        existing.cost += lineCost;
        existing.profit += lineRevenue - lineCost;
        existing.estimated = existing.estimated || isEstimate;
      } else {
        byProduct.set(lineItem.productId, {
          productId: lineItem.productId,
          name: lineItem.name,
          product,
          qty: lineItem.qty,
          revenue: lineRevenue,
          cost: lineCost,
          profit: lineRevenue - lineCost,
          estimated: isEstimate,
        });
      }
    }
  }

  return {
    rows: [...byProduct.values()].sort((a, b) => b.profit - a.profit),
    totals: { revenue, cost, profit: revenue - cost, bills: inRange.length, estimatedLines },
  };
}
