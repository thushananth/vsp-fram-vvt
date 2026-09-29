"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";

/**
 * Store-wide settings, admin-editable from Settings. Unlike CashierPermissions
 * these apply to *everyone* including admins — they are shop policy, not a
 * per-role capability.
 */
export interface StoreSettings {
  /** Auto-print a receipt on the thermal printer when a sale is charged. */
  printBills: boolean;
  /** Require every new browser/device to be approved before it can be used. */
  deviceVerification: boolean;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  printBills: true,
  // Off until an admin turns it on: with no SMTP configured and no approved
  // device yet, defaulting this on would lock a working shop out of its till.
  deviceVerification: false,
};

const STORE_DOC = "settings/store";

export function useStoreSettings(): { settings: StoreSettings; loading: boolean } {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubSnapshot: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setSettings(DEFAULT_STORE_SETTINGS);
        setLoading(false);
        if (unsubSnapshot) {
          unsubSnapshot();
          unsubSnapshot = null;
        }
        return;
      }
      unsubSnapshot = onSnapshot(
        doc(db, STORE_DOC),
        (snap) => {
          setSettings({ ...DEFAULT_STORE_SETTINGS, ...(snap.data() as Partial<StoreSettings> | undefined) });
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

  return { settings, loading };
}

export async function saveStoreSettings(settings: StoreSettings) {
  await setDoc(doc(db, STORE_DOC), settings, { merge: true });
}
