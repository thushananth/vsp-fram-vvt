"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { Product } from "@/lib/types";

export const PRODUCT_UNITS = ["pieces", "kg", "g", "litre", "packet"] as const;

/**
 * Products written before cost price existed (and everything the Flutter
 * migration brings over) have no costPrice/unit, so both are defaulted here
 * rather than at every call site.
 */
function toProduct(id: string, data: Record<string, unknown>): Product {
  return {
    ...(data as Omit<Product, "id" | "costPrice" | "unit" | "imageUrl">),
    id,
    costPrice: (data.costPrice as number) ?? 0,
    unit: (data.unit as string) ?? "pieces",
    imageUrl: (data.imageUrl as string) || null,
  };
}

export function useProducts(): { products: Product[]; loading: boolean } {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setProducts([]);
        setLoading(false);
        if (unsubSnapshot) {
          unsubSnapshot();
          unsubSnapshot = null;
        }
        return;
      }
      const q = query(collection(db, "products"), where("active", "==", true));
      unsubSnapshot = onSnapshot(
        q,
        (snap) => {
          setProducts(snap.docs.map((d) => toProduct(d.id, d.data())));
          setLoading(false);
        },
        (err) => {
          if (err.code !== "permission-denied") {
            console.error("products snapshot error", err);
          }
          setLoading(false);
        },
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, []);

  return { products, loading };
}

/** Create a new bakery product or barcoded good (Stock → New item). */
export async function createProduct(params: {
  name: string;
  price: number;
  costPrice: number;
  unit: string;
  category: string;
  isBakery: boolean;
  barcode: string | null;
  minLevel: number | null;
  maxLevel: number | null;
  imageUrl: string | null;
}) {
  const { name, price, costPrice, unit, category, isBakery, barcode, minLevel, maxLevel, imageUrl } =
    params;
  const ref = await addDoc(collection(db, "products"), {
    name,
    price,
    lastPrice: price,
    costPrice,
    unit,
    category,
    isBakery,
    barcode: isBakery ? null : barcode,
    expiryDate: null,
    minLevel,
    maxLevel,
    active: true,
    onShelf: 0,
    imageUrl,
  });
  return ref.id;
}

/**
 * Attach or clear a product photo. Split out from the stock sheets because the
 * upload finishes on its own schedule — the picture lands as soon as it is
 * chosen, without waiting for Save.
 */
export async function setProductImage(productId: string, imageUrl: string | null) {
  await setDoc(doc(db, "products", productId), { imageUrl }, { merge: true });
}

/**
 * Stock → Add Stock on an existing item. `increment` rather than writing a
 * total, so two people receiving deliveries at once both count; the purchase
 * log entry commits in the same batch, so the paper trail never disagrees
 * with the shelf.
 */
export async function addStockToProduct(params: {
  product: Product;
  qty: number;
  byUserId: string;
}) {
  const { product, qty, byUserId } = params;
  if (!(qty > 0)) throw new Error("Enter a quantity above 0.");
  const batch = writeBatch(db);
  batch.update(doc(db, "products", product.id), { onShelf: increment(qty), active: true });
  batch.set(doc(collection(db, "stockHistory")), {
    productId: product.id,
    name: product.name,
    qty,
    price: product.price,
    costPrice: product.costPrice,
    byUserId,
    createdAt: Date.now(),
  });
  await batch.commit();
}

/**
 * Stock → Add Stock for something the shop has never stocked before: the
 * product and its opening quantity in one write, so it shows up on Billing
 * ready to sell rather than at 0.
 */
export async function createProductWithStock(params: {
  name: string;
  price: number;
  costPrice: number;
  unit: string;
  category: string;
  isBakery: boolean;
  barcode: string | null;
  qty: number;
  byUserId: string;
}) {
  const { name, price, costPrice, unit, category, isBakery, barcode, qty, byUserId } = params;
  if (!name.trim()) throw new Error("Enter the item name.");
  if (!(price > 0)) throw new Error("Enter a selling price above 0.");
  if (!(qty > 0)) throw new Error("Enter a quantity above 0.");
  const productRef = doc(collection(db, "products"));
  const batch = writeBatch(db);
  batch.set(productRef, {
    name: name.trim(),
    price,
    lastPrice: price,
    costPrice,
    unit,
    category,
    isBakery,
    barcode: isBakery ? null : barcode,
    expiryDate: null,
    minLevel: null,
    maxLevel: null,
    active: true,
    onShelf: qty,
    imageUrl: null,
  });
  batch.set(doc(collection(db, "stockHistory")), {
    productId: productRef.id,
    name: name.trim(),
    qty,
    price,
    costPrice,
    byUserId,
    createdAt: Date.now(),
  });
  await batch.commit();
  return productRef.id;
}

/**
 * The five test items an earlier build's "+ Add 5 Sample Stock Items" button
 * wrote. Matched on name *and* the exact seeded prices, so an item the shop
 * created itself with the same name is never mistaken for one.
 */
const SAMPLE_SIGNATURES = [
  { name: "Whole Fresh Chicken", price: 1250, costPrice: 900 },
  { name: "Fresh Farm Eggs (Tray of 30)", price: 650, costPrice: 450 },
  { name: "Chicken Breast Fillet (1kg)", price: 1450, costPrice: 1100 },
  { name: "Layer Poultry Feed 25kg", price: 4800, costPrice: 3900 },
  { name: "Broiler Starter Feed 25kg", price: 5200, costPrice: 4200 },
];

export function isSampleProduct(p: Product): boolean {
  return SAMPLE_SIGNATURES.some(
    (s) => s.name === p.name && s.price === p.price && s.costPrice === p.costPrice,
  );
}

/**
 * Take the sample items out of Stock and Billing. Marked inactive rather than
 * deleted: any test bill that sold one still points at a real product, and an
 * admin can bring one back from the Firebase console if it was wanted.
 */
export async function removeSampleProducts(products: Product[]) {
  const samples = products.filter(isSampleProduct);
  if (samples.length === 0) return;
  const batch = writeBatch(db);
  for (const p of samples) batch.update(doc(db, "products", p.id), { active: false });
  await batch.commit();
}
