"use client";

import { useCallback, useEffect, useState } from "react";

// WebUSB ESC/POS printing for Xprinter thermal printers.
// Full reference: /docs/webusbXprinter.md

/** 0x1fc9 is the shop's Xprinter (NXP USB chip); the rest are common clones. */
export const XPRINTER_VENDOR_IDS = [0x1fc9, 0x0483, 0x1504, 0x04b8, 0x0dd4];

export interface PrintResult {
  success: boolean;
  error?: string;
  bytesWritten?: number;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Characters per line in the printer's default font. */
export function columnsFor(paperWidth: 58 | 80): number {
  return paperWidth === 58 ? 32 : 48;
}

/**
 * A ticket under construction. Thermal printers have no layout engine, so
 * columns are padded by hand to the paper's character width; everything
 * outside printable ASCII becomes "?" because the printer's code page can't
 * render it anyway.
 */
export class Ticket {
  private bytes: number[] = [ESC, 0x40]; // ESC @ — reset
  constructor(readonly cols: number) {}

  private raw(...b: number[]) {
    this.bytes.push(...b);
    return this;
  }

  text(s: string) {
    for (const ch of s) {
      const c = ch.charCodeAt(0);
      this.bytes.push(c >= 0x20 && c < 0x7f ? c : 0x3f);
    }
    return this;
  }

  line(s = "") {
    return this.text(s).raw(LF);
  }

  align(a: "left" | "center" | "right") {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** 1–2 times normal width/height. Double width halves the columns. */
  size(width: 1 | 2, height: 1 | 2) {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  rule(ch = "-") {
    return this.line(ch.repeat(this.cols));
  }

  /** Left text and right text on one line, the gap filled with spaces. */
  pair(left: string, right: string, cols = this.cols) {
    const room = Math.max(1, cols - right.length - 1);
    const l = left.length > room ? left.slice(0, room) : left;
    return this.line(l + " ".repeat(Math.max(1, cols - l.length - right.length)) + right);
  }

  /** Fixed-width columns; a negative width right-aligns that column. */
  columns(cells: string[], widths: number[]) {
    const out = cells
      .map((c, i) => {
        const w = Math.abs(widths[i]);
        const t = c.length > w ? c.slice(0, w) : c;
        return widths[i] < 0 ? t.padStart(w) : t.padEnd(w);
      })
      .join(" ");
    return this.line(out);
  }

  feed(n: number) {
    return this.raw(...Array(n).fill(LF));
  }

  /** Feed clear of the tear bar, then a partial cut. */
  cut() {
    return this.feed(3).raw(GS, 0x56, 0x42, 0x00);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(new ArrayBuffer(this.bytes.length));
    out.set(this.bytes);
    return out;
  }
}

async function pickPrinter(vendorIds: number[]): Promise<USBDevice> {
  const known = await navigator.usb.getDevices();
  return (
    known.find((d) => vendorIds.includes(d.vendorId)) ??
    (await navigator.usb.requestDevice({ filters: vendorIds.map((vendorId) => ({ vendorId })) }))
  );
}

/**
 * Send one or more tickets in a single USB transfer, so the counter copy
 * can't come out without the customer's receipt, or the other way round.
 */
export async function printTickets(
  tickets: Ticket[],
  vendorIds: number[] = XPRINTER_VENDOR_IDS,
): Promise<PrintResult> {
  if (!("usb" in navigator)) {
    return { success: false, error: "WebUSB not supported in this browser" };
  }
  if (tickets.length === 0) return { success: true, bytesWritten: 0 };

  let device: USBDevice;
  try {
    device = await pickPrinter(vendorIds);
  } catch (err) {
    return { success: false, error: `No printer selected: ${(err as Error).message}` };
  }

  try {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    const isBulkOut = (ep: USBEndpoint) => ep.direction === "out" && ep.type === "bulk";
    const iface = device.configuration!.interfaces.find((i) =>
      i.alternates.some((alt) => alt.endpoints.some(isBulkOut)),
    );
    if (!iface) return { success: false, error: "No bulk OUT interface found on the printer" };
    const alternate = iface.alternates.find((alt) => alt.endpoints.some(isBulkOut))!;
    const endpoint = alternate.endpoints.find(isBulkOut)!;

    await device.claimInterface(iface.interfaceNumber);
    if (iface.alternates.length > 1) {
      await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
    }

    const parts = tickets.map((t) => t.toBytes());
    const payload = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
    let offset = 0;
    for (const p of parts) {
      payload.set(p, offset);
      offset += p.length;
    }
    const result = await device.transferOut(endpoint.endpointNumber, payload);

    await device.releaseInterface(iface.interfaceNumber);
    await device.close();

    if (result.status !== "ok") {
      return { success: false, error: `Printer refused the data (${result.status})` };
    }
    return { success: true, bytesWritten: result.bytesWritten };
  } catch (err) {
    // A claimed-but-failed device stays open; close it so the next try starts clean.
    await device.close().catch(() => undefined);
    return { success: false, error: (err as Error).message };
  }
}

/** Reconnect to a previously authorized printer without showing the picker. */
export async function getAuthorizedPrinter(
  vendorIds: number[] = XPRINTER_VENDOR_IDS,
): Promise<USBDevice | undefined> {
  if (!("usb" in navigator)) return undefined;
  const devices = await navigator.usb.getDevices();
  return devices.find((d) => vendorIds.includes(d.vendorId));
}

export type PrinterStatus = "checking" | "unsupported" | "disconnected" | "connected";

/**
 * Live printer state for the till. WebUSB only reports devices this browser
 * has already been allowed to use, so "disconnected" covers both "unplugged"
 * and "never paired here" — connect() answers either by opening the picker.
 */
export function usePrinter(vendorIds: number[] = XPRINTER_VENDOR_IDS) {
  const [status, setStatus] = useState<PrinterStatus>("checking");
  const [name, setName] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const supported = typeof navigator !== "undefined" && "usb" in navigator;
    return (supported ? getAuthorizedPrinter(vendorIds) : Promise.resolve(undefined)).then(
      (device) => {
        setStatus(!supported ? "unsupported" : device ? "connected" : "disconnected");
        setName(device ? device.productName || "USB printer" : null);
      },
      () => setStatus("disconnected"),
    );
  }, [vendorIds]);

  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined" || !("usb" in navigator)) return;
    const onChange = () => void refresh();
    navigator.usb.addEventListener("connect", onChange);
    navigator.usb.addEventListener("disconnect", onChange);
    return () => {
      navigator.usb.removeEventListener("connect", onChange);
      navigator.usb.removeEventListener("disconnect", onChange);
    };
  }, [refresh]);

  /** Show the browser's picker. Must run from a click — WebUSB demands a user gesture. */
  const connect = useCallback(async (): Promise<PrintResult> => {
    if (!("usb" in navigator)) {
      return { success: false, error: "WebUSB not supported in this browser" };
    }
    try {
      await navigator.usb.requestDevice({ filters: vendorIds.map((vendorId) => ({ vendorId })) });
      await refresh();
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }, [vendorIds, refresh]);

  return { status, name, connect, refresh };
}
