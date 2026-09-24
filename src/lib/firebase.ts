"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "firebase/firestore";
import { type Auth, getAuth } from "firebase/auth";
import { type Functions, getFunctions } from "firebase/functions";
import { type FirebaseStorage, getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCodY9beHwUwSEI99LI2iebRTRTFkKMpBQ",
  authDomain: "vsp-farm-web.firebaseapp.com",
  projectId: "vsp-farm-web",
  storageBucket: "vsp-farm-web.firebasestorage.app",
  messagingSenderId: "1093401280933",
  appId: "1:1093401280933:web:64b320cbabf0f47f78a84c",
  measurementId: "G-VZ7PXNJ1VS",
};

// This build reads/writes a *named* Firestore database, separate from the
// (default) database the old Flutter app used — customers and stock were
// migrated across once (see functions/scripts/migrate-from-flutter.cjs).
const FIRESTORE_DATABASE_ID =
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ?? "vsp-farm-live-v1";

export const app: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

// Offline persistence (persistentLocalCache) must be set at construction
// time — enableIndexedDbPersistence() has to run before any other Firestore
// call, which is impossible to guarantee once multiple components touch
// `db`, so we configure it here instead of lazily.
export const db: Firestore = initializeFirestore(app, {
  localCache:
    typeof window === "undefined"
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}, FIRESTORE_DATABASE_ID);

export const auth: Auth = getAuth(app);
export const functions: Functions = getFunctions(app);
export const storage: FirebaseStorage = getStorage(app);
