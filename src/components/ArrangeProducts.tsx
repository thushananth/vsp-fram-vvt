"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { saveProductOrder } from "@/lib/firestore/products";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";

/**
 * Admin-only: drag the till's products into the order the shop wants. The
 * order is held for the whole catalogue, so switching category chips while
 * arranging keeps what was already moved; Save writes it all at once.
 */
export default function ArrangeProducts({
  products,
  visibleIds,
  colorOf,
  dense,
  onDone,
}: {
  products: Product[];
  /** The products the category chip currently shows — what can be dragged. */
  visibleIds: string[];
  colorOf: Map<string, string>;
  dense: boolean;
  onDone: (message: string | null) => void;
}) {
  const [order, setOrder] = useState(() => products.map((p) => p.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const visible = useMemo(() => {
    const show = new Set(visibleIds);
    return order.filter((id) => show.has(id) && byId.has(id));
  }, [order, visibleIds, byId]);
  const changed = order.some((id, i) => id !== products[i]?.id);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Press and hold to pick a tile up, so a plain swipe still scrolls the grid.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const moved = arrayMove(visible, visible.indexOf(String(active.id)), visible.indexOf(String(over.id)));
    // Put the reordered subset back into the slots it held in the full order,
    // so products in other categories keep their places.
    setOrder((prev) => {
      const slots = new Set(visible);
      let k = 0;
      return prev.map((id) => (slots.has(id) ? moved[k++] : id));
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveProductOrder(order);
      onDone("Product order saved");
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-surface/95 px-3.5 py-2.5 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">Arrange products</div>
          <div className="text-xs font-medium text-muted">
            Drag to reorder — on a tablet, press and hold a tile first. Use the chips to arrange one category.
          </div>
        </div>
        <button
          onClick={() => onDone(null)}
          disabled={saving}
          className="min-h-[42px] rounded-xl border border-border px-4 text-sm font-bold text-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !changed}
          className="min-h-[42px] rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save order"}
        </button>
        {error && <p className="w-full text-sm font-semibold text-danger">Not saved — {error}</p>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible} strategy={dense ? verticalListSortingStrategy : rectSortingStrategy}>
          <div className={dense ? "flex flex-col gap-1.5" : "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"}>
            {visible.map((id) => (
              <SortableTile key={id} product={byId.get(id)!} color={colorOf.get(byId.get(id)!.categoryId)} dense={dense} />
            ))}
            {visible.length === 0 && (
              <p className="col-span-full py-8 text-center text-muted">No products in this category.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableTile({ product: p, color, dense }: { product: Product; color?: string; dense: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition, touchAction: "manipulation" }}
      className={`relative cursor-grab select-none overflow-hidden border bg-surface active:cursor-grabbing ${
        isDragging ? "z-20 border-accent opacity-90 shadow-xl" : "border-dashed border-border"
      } ${dense ? "flex items-center gap-3 rounded-xl px-3 py-2.5" : "flex min-h-[96px] flex-col justify-between gap-2 rounded-2xl p-3 pt-4"}`}
    >
      {dense ? (
        <>
          <GripVertical className="h-5 w-5 shrink-0 text-muted-2" />
          <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "#94a3b8" }} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.name}</span>
          <span className="tabular-nums shrink-0 text-sm font-bold">{money(p.price)}</span>
        </>
      ) : (
        <>
          <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color ?? "#94a3b8" }} />
          <GripVertical className="absolute right-1.5 top-2.5 h-4 w-4 text-muted-2" />
          <span className="line-clamp-2 pr-4 text-[14px] font-bold leading-tight">{p.name}</span>
          <span className="tabular-nums text-[14px] font-extrabold">{money(p.price)}</span>
        </>
      )}
    </div>
  );
}
