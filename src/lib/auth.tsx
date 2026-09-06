"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Role } from "@/lib/types";
import { rememberEmail } from "@/lib/emailHistory";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profileResolved, setProfileResolved] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthResolved(true);
      if (!u) {
        setProfile(null);
        setProfileResolved(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileResolved(false);
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        const data = snap.data();
        setProfile(
          data
            ? {
                uid: user.uid,
                name: data.name ?? user.displayName ?? user.email ?? "User",
                email: data.email ?? user.email ?? "",
                role: data.role === "admin" ? "admin" : "cashier",
                active: data.active !== false,
              }
            : null,
        );
        setProfileResolved(true);
      },
      (err) => {
        // A denied or failed read must still unblock `loading` — otherwise
        // every screen gated on it (including the login page's own redirect)
        // shows its splash forever with no way out but a reload. Treated as
        // "no profile yet" rather than a crash: every `profile?.role` check
        // already reads that as the safe, non-admin default.
        console.error("user profile snapshot error", err);
        setProfile(null);
        setProfileResolved(true);
      },
    );
  }, [user]);

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
    rememberEmail(email);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading: !authResolved || (!!user && !profileResolved),
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
