"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
    const q = query(collection(db, "products"), where("active", "==", true));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProducts(snap.docs.map((d) => toProduct(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        console.error("products snapshot error", err);
        setLoading(false);
      },
    );
    return unsub;
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
