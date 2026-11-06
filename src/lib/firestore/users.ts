"use client";

import { collection, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useLive } from "@/lib/firestore/live";
import type { UserProfile } from "@/lib/auth";

const NO_USERS: UserProfile[] = [];

export function useUsers(): { users: UserProfile[]; loading: boolean } {
  const { data, loading } = useLive<UserProfile[]>("users", (emit, fail) =>
    // Sorted in JS, not with orderBy("name"): Firestore leaves any doc
    // without that field out of an ordered query, so a profile set up by
    // hand (say, only a role) would vanish from Users entirely.
    onSnapshot(
      query(collection(db, "users")),
      (snap) =>
        emit(
          snap.docs
            .map((d): UserProfile => {
              const data = d.data();
              return {
                uid: d.id,
                name: data.name ?? data.email ?? "User",
                email: data.email ?? "",
                role: data.role === "admin" ? "admin" : "cashier",
                active: data.active !== false,
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      fail,
    ),
  );
  return { users: data ?? NO_USERS, loading };
}
