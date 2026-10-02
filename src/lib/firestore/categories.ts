"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { CATEGORY_COLORS } from "@/lib/constants";
import type { Category } from "@/lib/types";

function toCategory(id: string, data: Record<string, unknown>): Category {
  return {
    id,
    name: (data.name as string) ?? "",
    unit: (data.unit as string) ?? "pcs",
    counterCopy: data.counterCopy === true,
    color: (data.color as string) || CATEGORY_COLORS[0],
    sortOrder: (data.sortOrder as number) ?? 0,
    active: data.active !== false,
  };
}

/** Every category, archived ones included — callers filter on `active`. */
export function useCategories(): { categories: Category[]; loading: boolean } {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      unsubSnapshot?.();
      unsubSnapshot = null;
      if (!u) {
        setCategories([]);
        setLoading(false);
        return;
      }
      unsubSnapshot = onSnapshot(
        collection(db, "categories"),
        (snap) => {
          setCategories(
            snap.docs
              .map((d) => toCategory(d.id, d.data()))
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
          );
          setLoading(false);
        },
        () => setLoading(false),
      );
    });
    return () => {
      unsubAuth();
      unsubSnapshot?.();
    };
  }, []);

  return { categories, loading };
}

export type CategoryInput = Pick<Category, "name" | "unit" | "counterCopy" | "color">;

export async function createCategory(input: CategoryInput, sortOrder: number) {
  const ref = await addDoc(collection(db, "categories"), {
    ...input,
    name: input.name.trim(),
    sortOrder,
    active: true,
  });
  return ref.id;
}

/**
 * A rename is copied onto every product in the category in the same batch —
 * products carry the name so bills and reports never need a lookup.
 */
export async function updateCategory(
  category: Category,
  input: CategoryInput,
  productIds: string[],
) {
  const batch = writeBatch(db);
  const name = input.name.trim();
  batch.set(doc(db, "categories", category.id), { ...input, name }, { merge: true });
  if (name !== category.name) {
    for (const id of productIds) batch.set(doc(db, "products", id), { category: name }, { merge: true });
  }
  await batch.commit();
}

/** Archived, never deleted: past bills still name it in their reports. */
export async function setCategoryActive(categoryId: string, active: boolean) {
  await setDoc(doc(db, "categories", categoryId), { active }, { merge: true });
}

/** Persist a new order after a move up/down. */
export async function reorderCategories(ordered: Category[]) {
  const batch = writeBatch(db);
  ordered.forEach((c, i) => batch.set(doc(db, "categories", c.id), { sortOrder: i }, { merge: true }));
  await batch.commit();
}
