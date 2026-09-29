"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { UserProfile } from "@/lib/auth";

export function useUsers(): { users: UserProfile[]; loading: boolean } {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUsers([]);
        setLoading(false);
        if (unsubSnapshot) {
          unsubSnapshot();
          unsubSnapshot = null;
        }
        return;
      }
      // Sorted in JS, not with orderBy("name"): Firestore leaves any doc
      // without that field out of an ordered query, so a profile set up by
      // hand (say, only a role) would vanish from Users entirely.
      const q = query(collection(db, "users"));
      unsubSnapshot = onSnapshot(
        q,
        (snap) => {
          setUsers(
            snap.docs.map((d): UserProfile => {
              const data = d.data();
              return {
                uid: d.id,
                name: data.name ?? data.email ?? "User",
                email: data.email ?? "",
                role: data.role === "admin" ? "admin" : "cashier",
                active: data.active !== false,
              };
            }).sort((a, b) => a.name.localeCompare(b.name)),
          );
          setLoading(false);
        },
        () => setLoading(false),
      );
    });

    return () => {
      unsubAuth();
      if (unsubSnapshot) unsubSnapshot();
    };
  }, []);

  return { users, loading };
}
