"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { Product } from "@/lib/types";

function toProduct(id: string, data: Record<string, unknown>): Product {
  return {
    id,
    name: (data.name as string) ?? "",
    price: (data.price as number) ?? 0,
    costPrice: (data.costPrice as number) ?? 0,
    unit: (data.unit as string) ?? "pcs",
    categoryId: (data.categoryId as string) ?? "",
    category: (data.category as string) ?? "",
    barcode: (data.barcode as string) || null,
    active: data.active !== false,
    sortOrder: (data.sortOrder as number) ?? 0,
    imageUrl: (data.imageUrl as string) || null,
  };
}

/**
 * Products, sorted the way the till shows them. Billing wants only the active
 * ones; the Products screen passes `includeInactive` to manage the rest.
 */
export function useProducts(options: { includeInactive?: boolean } = {}): {
  products: Product[];
  loading: boolean;
} {
  const { includeInactive = false } = options;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubSnapshot?.();
      unsubSnapshot = null;
      if (!u) {
        setProducts([]);
        setLoading(false);
        return;
      }
      unsubSnapshot = onSnapshot(
        collection(db, "products"),
        (snap) => {
          setProducts(
            snap.docs
              .map((d) => toProduct(d.id, d.data()))
              .filter((p) => includeInactive || p.active)
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
          );
          setLoading(false);
        },
        (err) => {
          if (err.code !== "permission-denied") console.error("products snapshot error", err);
          setLoading(false);
        },
      );
    });
    return () => {
      unsubAuth();
      unsubSnapshot?.();
    };
  }, [includeInactive]);

  return { products, loading };
}

export type ProductInput = Pick<
  Product,
  "name" | "price" | "costPrice" | "unit" | "categoryId" | "category" | "barcode"
>;

function clean(input: ProductInput) {
  if (!input.name.trim()) throw new Error("Enter the product name.");
  if (!input.categoryId) throw new Error("Pick a category.");
  if (!(input.price >= 0)) throw new Error("Enter a price.");
  return { ...input, name: input.name.trim(), barcode: input.barcode?.trim() || null };
}

export async function createProduct(input: ProductInput) {
  const ref = await addDoc(collection(db, "products"), {
    ...clean(input),
    active: true,
    sortOrder: Date.now(),
    imageUrl: null,
  });
  return ref.id;
}

export async function updateProduct(productId: string, input: ProductInput) {
  await setDoc(doc(db, "products", productId), clean(input), { merge: true });
}

/** Hidden from the till, kept for history — old bills still point at it. */
export async function setProductActive(productId: string, active: boolean) {
  await setDoc(doc(db, "products", productId), { active }, { merge: true });
}

/**
 * Save the till's product order. Every listed product is renumbered (10, 20,
 * 30…) rather than swapping the moved ones' values — products imported with
 * the same sortOrder would otherwise still tie and fall back to name order.
 */
export async function saveProductOrder(orderedIds: string[]) {
  // A batch holds 500 writes; a shop's catalogue can outgrow one.
  for (let start = 0; start < orderedIds.length; start += 450) {
    const batch = writeBatch(db);
    orderedIds.slice(start, start + 450).forEach((id, i) => {
      batch.set(doc(db, "products", id), { sortOrder: (start + i + 1) * 10 }, { merge: true });
    });
    await batch.commit();
  }
}
