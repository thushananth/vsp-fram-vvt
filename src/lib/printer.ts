"use client";

// WebUSB ESC/POS printing for Xprinter thermal printers.
// Full reference: /docs/webusbXprinter.md

export const XPRINTER_VENDOR_IDS = [0x1fc9, 0x0483, 0x1504, 0x04b8, 0x0dd4];

export interface PrintReceiptOptions {
  lines: string[];
  vendorIds?: number[];
  cuts?: boolean;
  feedLines?: number;
}

export interface PrintResult {
  success: boolean;
  error?: string;
  bytesWritten?: number;
}

const ESC = 0x1b;
const GS = 0x1d;

function buildEscPos(lines: string[], cuts: boolean, feedLines: number): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  chunks.push(new Uint8Array([ESC, 0x40])); // ESC @ — initialize

  for (const line of lines) {
    chunks.push(encoder.encode(line + "\n"));
  }

  chunks.push(new Uint8Array(Array(feedLines).fill(0x0a))); // feed before cut

  if (cuts) {
    chunks.push(new Uint8Array([GS, 0x56, 0x42, 0x00])); // GS V 66 — partial cut
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function printReceipt({
  lines,
  vendorIds = XPRINTER_VENDOR_IDS,
  cuts = true,
  feedLines = 4,
}: PrintReceiptOptions): Promise<PrintResult> {
  if (!("usb" in navigator)) {
    return { success: false, error: "WebUSB not supported in this browser" };
  }

  let device: USBDevice;
  try {
    const known = await navigator.usb.getDevices();
    device =
      known.find((d) => vendorIds.includes(d.vendorId)) ??
      (await navigator.usb.requestDevice({
        filters: vendorIds.map((vendorId) => ({ vendorId })),
      }));
  } catch (err) {
    return { success: false, error: `No device selected: ${(err as Error).message}` };
  }

  try {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const iface = device.configuration!.interfaces.find((i) =>
      i.alternates.some((alt) =>
        alt.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
      ),
    );
    if (!iface) {
      return { success: false, error: "No bulk OUT interface found on device" };
    }

    const alternate = iface.alternates.find((alt) =>
      alt.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
    )!;
    const endpoint = alternate.endpoints.find(
      (ep) => ep.direction === "out" && ep.type === "bulk",
    )!;

    await device.claimInterface(iface.interfaceNumber);
    if (iface.alternates.length > 1) {
      await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
    }

    const payload = buildEscPos(lines, cuts, feedLines);
    const result = await device.transferOut(endpoint.endpointNumber, payload);

    await device.releaseInterface(iface.interfaceNumber);
    await device.close();

    if (result.status !== "ok") {
      return { success: false, error: `transferOut failed: status=${result.status}` };
    }
    return { success: true, bytesWritten: result.bytesWritten };
  } catch (err) {
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
