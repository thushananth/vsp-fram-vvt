"use client";

/**
 * Guard for the writes that genuinely need the server — transactions, and the
 * corrections built on them.
 *
 * Firestore does not reject when it can't reach the server: a transaction on a
 * dead connection just never settles, which shows up as a button that spins
 * forever. `navigator.onLine` doesn't catch it either, because weak shop wifi
 * reports "online" while nothing gets through. So we give the promise a
 * deadline and turn the silence into an error the cashier can act on.
 *
 * Note this only ends the *waiting*. A transaction can't be cancelled, so one
 * that was already in flight may still land — which is why the caller writes
 * the whole timeout message: only it knows whether a late success is harmless.
 */

const DEFAULT_TIMEOUT_MS = 12_000;

export function requireServer<T>(
  work: Promise<T>,
  timeoutMessage: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // Swallow a late rejection on the original promise — the caller has already
  // been handed the timeout error and nothing is left listening.
  work.catch(() => {});

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
