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
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// UAT build reads/writes a *named* Firestore database, separate from the
// (default) database the Flutter app uses, so we never touch live data.
const FIRESTORE_DATABASE_ID =
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ?? "bake-shop-uat-v2";

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
