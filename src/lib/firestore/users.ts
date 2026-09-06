"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserProfile } from "@/lib/auth";

export function useUsers(): { users: UserProfile[]; loading: boolean } {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("name"));
    return onSnapshot(
      q,
      (snap) => {
        setUsers(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              uid: d.id,
              name: data.name ?? data.email ?? "User",
              email: data.email ?? "",
              role: data.role === "admin" ? "admin" : "cashier",
              active: data.active !== false,
            };
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  return { users, loading };
}
