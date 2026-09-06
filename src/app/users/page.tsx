"use client";

import { useState } from "react";
import { useAdminGate } from "@/components/AdminGate";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useAuth, type UserProfile } from "@/lib/auth";
import { useUsers } from "@/lib/firestore/users";
import type { Role } from "@/lib/types";

const createUserFn = httpsCallable<
  { email: string; password: string; name: string; role: Role },
  { uid: string }
>(functions, "createUser");

const updateUserFn = httpsCallable<{ uid: string; name: string; role: Role }, { ok: true }>(
  functions,
  "updateUser",
);

const resetPasswordFn = httpsCallable<{ uid: string; newPassword: string }, { ok: true }>(
  functions,
  "resetUserPassword",
);

const deleteUserFn = httpsCallable<{ uid: string }, { ok: true }>(functions, "deleteUser");

export default function UsersPage() {
  const gate = useAdminGate("Users", "Creating and changing staff accounts stays with admins.");
  const { profile } = useAuth();
  const { users, loading } = useUsers();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<UserProfile | null>(null);


  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      await createUserFn({ email: email.trim(), password, name: name.trim(), role });
      setMessage(`${name} created — they can sign in with the email/password you set.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("cashier");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }


  // Denied by default until the profile says otherwise.
  if (gate) return gate;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl font-extrabold">Users</h1>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-bold text-muted">Add a user</h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold sm:col-span-1">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold sm:col-span-1">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"
            >
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"
            />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm font-semibold">
            Temporary password
            <input
              required
              minLength={6}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-sm font-normal outline-none focus:border-accent"
            />
          </label>
        </div>

        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        {message && <p className="text-sm font-semibold text-success">{message}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-[48px] rounded-xl bg-accent text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create user"}
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold text-muted">All users</h2>
        {loading ? (
          <p className="text-muted">Loading…</p>
        ) : (
          users.map((u) => (
            <button
              key={u.uid}
              onClick={() => setManaging(u)}
              className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{u.name}</p>
                <p className="truncate text-xs text-muted">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!u.active && (
                  <span className="rounded-full bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger">
                    Disabled
                  </span>
                )}
                <span className="rounded-full bg-accent/10 px-2 py-1 text-[11px] font-semibold capitalize text-accent">
                  {u.role}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {managing && profile && (
        <ManageUserSheet
          user={managing}
          selfUid={profile.uid}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}

function ManageUserSheet({
  user,
  selfUid,
  onClose,
}: {
  user: UserProfile;
  selfUid: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isSelf = user.uid === selfUid;

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSavingEdit(true);
    try {
      await updateUserFn({ uid: user.uid, name: name.trim(), role });
      setMessage("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setResetting(true);
    try {
      await resetPasswordFn({ uid: user.uid, newPassword });
      setMessage(`Password reset — share it with ${user.name} directly.`);
      setNewPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteUserFn({ uid: user.uid });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-ink/50">
      <div className="mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xl font-extrabold">{user.name}</div>
            <div className="truncate text-sm font-medium text-muted">{user.email}</div>
          </div>
          <button
            onClick={onClose}
            className="min-h-[42px] shrink-0 rounded-lg border border-border px-3.5 text-sm font-bold text-muted"
          >
            Close
          </button>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
        {message && <p className="mt-3 text-sm font-semibold text-success">{message}</p>}

        <form onSubmit={handleSaveEdit} className="mt-5 flex flex-col gap-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">
            Edit user
          </h3>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Role
            <select
              disabled={isSelf}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {isSelf && (
            <p className="text-xs font-medium text-muted-2">You can&apos;t change your own role.</p>
          )}
          <button
            type="submit"
            disabled={savingEdit}
            className="min-h-[48px] rounded-xl bg-accent text-sm font-bold text-white disabled:opacity-50"
          >
            {savingEdit ? "Saving…" : "Save changes"}
          </button>
        </form>

        <form onSubmit={handleResetPassword} className="mt-6 flex flex-col gap-3 border-t border-border pt-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-2">
            Reset password
          </h3>
          <input
            required
            minLength={6}
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password — at least 6 characters"
            className="rounded-xl border border-border bg-ground px-3 py-2.5 text-base font-normal outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={resetting}
            className="min-h-[48px] rounded-xl border border-accent text-sm font-bold text-accent disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Set new password"}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3 border-t border-danger/20 pt-5">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-danger">
            Delete user
          </h3>
          {isSelf ? (
            <p className="text-xs font-medium text-muted-2">You can&apos;t delete your own account.</p>
          ) : !confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="min-h-[48px] rounded-xl border border-danger/40 text-sm font-bold text-danger"
            >
              Delete {user.name}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-danger">
                This permanently deletes their sign-in and profile. This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="min-h-[48px] flex-1 rounded-xl border border-border text-sm font-bold text-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="min-h-[48px] flex-1 rounded-xl bg-danger text-sm font-bold text-white disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
