"use client";

import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

/**
 * Product photos: taken on the shop tablet, shown on the billing grid so a
 * cashier can pick a bun by sight instead of by name.
 *
 * Everything here needs the network — Firebase Storage has no offline queue,
 * unlike Firestore. That is fine: adding a photo is a back-office job done at
 * the stock screen, never something a sale waits on. Photos already uploaded
 * keep showing offline because the service worker caches them.
 */

/** Longest edge after downscaling. A tablet camera shot is 4000px and ~4 MB. */
const MAX_EDGE = 640;
const JPEG_QUALITY = 0.82;
/** Matches the cap in storage.rules — the rules can't trust the client. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Shrink a camera photo before it ever touches the network. A shop on weak
 * wifi cannot spend 4 MB on a picture of a bun, and the grid renders it at
 * about 100px anyway.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize the photo");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Couldn't read that photo");
  return blob;
}

/**
 * Put a photo on a product and hand back its URL. The path is keyed on the
 * product id with a timestamp, so replacing a photo writes a new object rather
 * than fighting the CDN over a cached one.
 */
export async function uploadProductImage(productId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file isn't an image");
  }

  const blob = await downscale(file);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("That photo is too large even after resizing");
  }

  const path = `products/${productId}/${Date.now()}.jpg`;
  await uploadBytes(ref(storage, path), blob, { contentType: "image/jpeg" });
  return getDownloadURL(ref(storage, path));
}

/**
 * Whether a URL points at this project's own bucket. The Flutter migration
 * brings `imageUrl`s across from elsewhere, and `ref(storage, url)` on a
 * foreign URL can resolve *by path* against this bucket — which would delete
 * the wrong object rather than failing.
 */
function isOwnedByThisBucket(imageUrl: string): boolean {
  const bucket = storage.app.options.storageBucket;
  if (!bucket) return false;
  try {
    const url = new URL(imageUrl);
    return url.pathname.includes(`/b/${bucket}/o/`) || url.hostname === bucket;
  } catch {
    return false;
  }
}

/**
 * Best-effort tidy-up when a photo is replaced or removed. A failure here is
 * ignored on purpose: an orphaned object costs a few kilobytes, while a thrown
 * error would block the cashier from changing the picture.
 */
export async function deleteProductImage(imageUrl: string): Promise<void> {
  // A migrated URL belongs to whoever hosts it; leave it alone entirely.
  if (!isOwnedByThisBucket(imageUrl)) return;
  try {
    await deleteObject(ref(storage, imageUrl));
  } catch {
    // Already gone, or never uploaded through this app.
  }
}
