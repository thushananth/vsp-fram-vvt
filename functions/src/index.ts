import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { db } from "./db";

export { requestDeviceApproval, verifyDeviceCode, setDeviceStatus, removeDevice } from "./devices";

interface CreateUserData {
  email: string;
  password: string;
  name: string;
  role: "cashier" | "admin";
}

/**
 * Admin-only: create a new cashier/admin user. Runs server-side with the
 * Admin SDK so the calling admin's own session is never disturbed (the
 * client SDK can't create a second user without signing the first one out).
 */
export const createUser = onCall<CreateUserData>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }

  const callerProfile = await db.doc(`users/${request.auth.uid}`).get();
  if (callerProfile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }

  const { email, password, name, role } = request.data;
  if (!email || !password || !name || (role !== "admin" && role !== "cashier")) {
    throw new HttpsError("invalid-argument", "email, password, name and role are required");
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters");
  }

  let uid: string;
  try {
    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: name,
    });
    uid = userRecord.uid;
  } catch (err) {
    // Auth's own codes say exactly what was wrong with the input — pass them
    // through instead of burying them under a generic "internal".
    const code = (err as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account with this email already exists");
    }
    if (code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "That email address isn't valid");
    }
    if (code === "auth/invalid-password") {
      throw new HttpsError("invalid-argument", "Password must be at least 6 characters");
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new HttpsError("internal", `Failed to create user: ${message}`);
  }

  try {
    await getAuth().setCustomUserClaims(uid, { role });

    await db.doc(`users/${uid}`).set({
      name,
      email,
      role,
      active: true,
      createdAt: Date.now(),
      createdBy: request.auth.uid,
    });

    return { uid };
  } catch (err) {
    // The login exists but its profile doesn't: remove the login so the admin
    // can simply try again, rather than leaving an account that can't be
    // used and blocks the email with "already exists".
    await getAuth().deleteUser(uid).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new HttpsError("internal", `Failed to create user: ${message}`);
  }
});

/** Admin-only: disable/enable a user without deleting their history. */
export const setUserActive = onCall<{ uid: string; active: boolean }>(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const callerProfile = await db.doc(`users/${request.auth.uid}`).get();
  if (callerProfile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }

  const { uid, active } = request.data;
  await getAuth().updateUser(uid, { disabled: !active });
  await db.doc(`users/${uid}`).set({ active }, { merge: true });
  return { ok: true };
});

async function requireAdmin(authUid: string | undefined) {
  if (!authUid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const callerProfile = await db.doc(`users/${authUid}`).get();
  if (callerProfile.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin role required");
  }
}

/**
 * Admin-only: edit a user's name/role (never their email — email changes
 * would desync Auth from the login flow, so that stays out of scope here).
 */
export const updateUser = onCall<{ uid: string; name: string; role: "cashier" | "admin" }>(
  async (request) => {
    await requireAdmin(request.auth?.uid);

    const { uid, name, role } = request.data;
    if (!uid || !name || (role !== "admin" && role !== "cashier")) {
      throw new HttpsError("invalid-argument", "uid, name and role are required");
    }

    try {
      await getAuth().updateUser(uid, { displayName: name });
      await getAuth().setCustomUserClaims(uid, { role });
      await db.doc(`users/${uid}`).set({ name, role }, { merge: true });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new HttpsError("internal", `Failed to update user: ${message}`);
    }
  },
);

/** Admin-only: set a new password for a user directly (no email flow). */
export const resetUserPassword = onCall<{ uid: string; newPassword: string }>(async (request) => {
  await requireAdmin(request.auth?.uid);

  const { uid, newPassword } = request.data;
  if (!uid || !newPassword || newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "uid and a password of at least 6 characters are required");
  }

  try {
    await getAuth().updateUser(uid, { password: newPassword });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new HttpsError("internal", `Failed to reset password: ${message}`);
  }
});

/** Admin-only: permanently delete a user's Auth account and profile. */
export const deleteUser = onCall<{ uid: string }>(async (request) => {
  await requireAdmin(request.auth?.uid);

  const { uid } = request.data;
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required");
  }
  if (uid === request.auth!.uid) {
    throw new HttpsError("failed-precondition", "You can't delete your own account");
  }

  try {
    await getAuth().deleteUser(uid);
    await db.doc(`users/${uid}`).delete();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    throw new HttpsError("internal", `Failed to delete user: ${message}`);
  }
});
