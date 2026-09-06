"use client";

import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import ProductThumb from "@/components/ui/ProductThumb";

/**
 * The photo row inside the stock sheets. Presentational: it picks a file and
 * reports it upward, so the sheet decides whether to upload straight away (an
 * existing product) or wait until the product has an id (a new one).
 */
export default function ProductImageField({
  name,
  imageUrl,
  busy,
  error,
  onPick,
  onRemove,
}: {
  name: string;
  /** The saved URL, or a local object URL while a new item is being created. */
  imageUrl: string | null;
  busy: boolean;
  error: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [choosing, setChoosing] = useState(false);

  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-2">Photo</div>
      <div className="flex items-center gap-3">
        <div className="h-[68px] w-[68px] overflow-hidden rounded-xl border border-border">
          <ProductThumb name={name} imageUrl={imageUrl} />
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setChoosing(true);
              input.current?.click();
            }}
            className="min-h-[44px] rounded-xl border border-border bg-ground text-sm font-bold disabled:opacity-50"
          >
            <Camera className="mr-1.5 inline h-4 w-4" />
            {busy ? "Uploading…" : imageUrl ? "Change photo" : "Add photo"}
          </button>
          {imageUrl && !busy && (
            <button
              type="button"
              onClick={onRemove}
              className="min-h-[38px] rounded-xl border border-danger/30 text-[13px] font-bold text-danger"
            >
              <Trash2 className="mr-1.5 inline h-3.5 w-3.5" />
              Remove photo
            </button>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the camera straight away on the shop tablet, while still
        // allowing the gallery on a desktop browser.
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file twice still fires a change event.
          e.target.value = "";
          setChoosing(false);
          if (file) onPick(file);
        }}
      />

      {error && (
        <p role="alert" className="mt-2 text-xs font-bold text-danger">
          {error}
        </p>
      )}
      {!error && choosing && !busy && (
        <p className="mt-2 text-xs font-medium text-muted-2">Waiting for the camera…</p>
      )}
    </div>
  );
}
