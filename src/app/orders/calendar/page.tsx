"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { usePermissionGate } from "@/components/AdminGate";
import NavPending from "@/components/NavPending";
import OrderCalendar from "@/components/orders/OrderCalendar";
import OrderSheet from "@/components/orders/OrderSheet";
import OrderForm from "@/components/orders/OrderForm";
import SendOutSheet from "@/components/orders/SendOutSheet";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/firestore/permissions";
import { useOrders } from "@/lib/firestore/orders";
import { monthBounds } from "@/lib/orders";
import type { Order } from "@/lib/types";

/** A month of orders on its own screen, from the calendar icon on Orders. */
export default function OrderCalendarPage() {
  const gate = usePermissionGate("manageOrders", "Orders", "An admin has switched advance orders off for cashiers.");
  const { profile } = useAuth();
  const { permissions } = usePermissions();
  const isAdmin = profile?.role === "admin";
  const canManage = isAdmin || permissions.manageOrders;

  const [picked, setPicked] = useState<Order | null>(null);
  const [mode, setMode] = useState<"view" | "send" | "edit">("view");
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  // The calendar already listens to this month, so this shares its listener
  // and keeps the open order live.
  const { orders } = useOrders(picked ? monthBounds(picked.deliveryDate) : null);
  const order = picked ? (orders.find((o) => o.id === picked.id) ?? picked) : null;

  if (gate) return gate;

  function say(text: string, error = false) {
    setNotice({ text, error });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), error ? 8000 : 3500);
  }
  function close() {
    setPicked(null);
    setMode("view");
  }

  return (
    <div className="mx-auto max-w-3xl p-4 pb-8">
      <div className="mb-3 flex items-center gap-3">
        <Link
          href="/orders"
          aria-label="Back to Orders"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted"
        >
          <ChevronLeft className="h-5 w-5" />
          <NavPending tone="light" />
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Order calendar</h1>
          <p className="text-sm font-medium text-muted">Tap a day to see its orders, tap an order to open it</p>
        </div>
      </div>

      <OrderCalendar standalone onOpen={(o) => setPicked(o)} />

      {notice && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg md:bottom-6 ${
            notice.error ? "bg-danger" : "bg-ink"
          }`}
        >
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      {order && mode === "view" && (
        <OrderSheet
          order={order}
          canManage={canManage}
          onClose={close}
          onSendOut={() => setMode("send")}
          onEdit={() => setMode("edit")}
          onNotice={say}
        />
      )}
      {order && mode === "send" && (
        <SendOutSheet
          order={order}
          onClose={() => setMode("view")}
          onSent={(text, error) => {
            close();
            say(text, error);
          }}
        />
      )}
      {order && mode === "edit" && (
        <OrderForm
          order={order}
          isAdmin={isAdmin}
          onClose={() => setMode("view")}
          onSaved={(text) => {
            close();
            say(text);
          }}
        />
      )}
    </div>
  );
}
