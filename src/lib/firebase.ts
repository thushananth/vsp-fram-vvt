"use client";

import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  type Firestore,
  getFirestore,
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
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ?? "(default)";

export const app: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

/**
 * App Check: proves requests come from this app in a real browser, not from a
 * script holding a stolen password. reCAPTCHA Enterprise, score-based and
 * invisible: the cashier never sees a challenge.
 *
 * The site key is public (it ships in every page). It only works on the
 * domains listed on the key in Google Cloud (reCAPTCHA → Keys → "VSP Farm"),
 * so App Check is started only there; on localhost it would just collect
 * rejected tokens. Enforcement is switched on per service in the Firebase
 * console once the App Check page shows the till's traffic as verified.
 * Offline, token refresh fails quietly and queued writes still flush later.
 */
export const RECAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? "6LfwoRMuAAAAAPDJ_7d25Yz_I_Girbr9-uQIDZUb";
/** Keep in step with the key's allowed domains in Google Cloud. */
const APP_CHECK_HOSTS = ["vsp-farm-web.web.app"];

const globalForCheck = globalThis as typeof globalThis & { __vspAppCheck?: boolean };

/**
 * Called once from RootShell after the first render, never at import: the
 * reCAPTCHA script adds a hidden element to <body>, and done during
 * hydration React removes it again ("placeholder element must be an element").
 * Firestore and Auth pick App Check up when it starts; their first requests
 * only go out after sign-in resolves, which is later.
 */
export function startAppCheck(): void {
  if (typeof window === "undefined" || globalForCheck.__vspAppCheck) return;
  if (!RECAPTCHA_SITE_KEY || !APP_CHECK_HOSTS.includes(window.location.hostname)) return;
  globalForCheck.__vspAppCheck = true;
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Offline persistence (persistentLocalCache) must be set at construction
// time — enableIndexedDbPersistence() has to run before any other Firestore
// call, which is impossible to guarantee once multiple components touch
// `db`, so we configure it here instead of lazily.
function initDb(): Firestore {
  try {
    return initializeFirestore(app, {
      // Long polling instead of one long-lived streaming response. On shop
      // wifi / mobile data that drops HTTP/3 (QUIC) packets the stream kept
      // dying ("WebChannelConnection RPC 'Listen' stream transport errored",
      // ERR_QUIC_PROTOCOL_ERROR) and reconnecting in a loop. Auto-detect only
      // checks at connect time, so it never caught streams that die later.
      // Real-time updates and offline persistence work the same either way.
      experimentalForceLongPolling: true,
      localCache:
        typeof window === "undefined"
          ? memoryLocalCache()
          : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    }, FIRESTORE_DATABASE_ID);
  } catch {
    // Hot reload re-runs this module against the app getApps() handed back,
    // which already has Firestore — reuse that instance instead of crashing.
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  }
}

// Kept on globalThis so a hot reload in `next dev` picks up the instance it
// already made rather than asking Firestore for a second one.
const globalForDb = globalThis as typeof globalThis & { __vspFirestore?: Firestore };
export const db: Firestore = (globalForDb.__vspFirestore ??= initDb());

export const auth: Auth = getAuth(app);
export const functions: Functions = getFunctions(app);
export const storage: FirebaseStorage = getStorage(app);
