import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This build's own Firestore database — never the Flutter app's default one.
export const FIRESTORE_DATABASE_ID = "(default)";

// Initialised here rather than in index.ts so every module that imports `db`
// gets an app that is already initialised, whatever the import order is.
if (!getApps().length) initializeApp();

export const db = getFirestore(FIRESTORE_DATABASE_ID);
