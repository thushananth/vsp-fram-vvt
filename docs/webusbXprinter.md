# WebUSB Printing for Xprinter POS Thermal Printers

CLAUDE CODE CONTEXT FILE. Read this file first before implementing a WebUSB
print function in any web project. No other reference should be needed.

Scope: WebUSB-based ESC/POS printing for Xprinter 80mm thermal printers.
Platforms: Windows, macOS, Android (USB OTG). Browsers: Chrome and Edge only.
Connection: USB only — no Bluetooth, no network.

---

## 1. Platform Support Matrix

| Platform | Browser | Support | Notes |
| --- | --- | --- | --- |
| Windows | Chrome / Edge | ✅ Works | No setup needed |
| macOS | Chrome / Edge | ✅ Works | No setup needed |
| Android | Chrome (USB OTG cable) | ✅ Works | No setup needed; needs a USB-OTG cable/adapter |
| Linux | Chrome / Edge | ✅ Works | Needs a udev rule (below) or the browser can't open the device |
| iOS | Any | ❌ Not supported | Apple does not implement the WebUSB spec in WebKit, and WebKit is mandatory for every iOS browser (including "Chrome" on iOS) |
| Firefox | — | ❌ Not supported | Firefox has not implemented the WebUSB spec |
| Safari | — | ❌ Not supported | WebKit does not implement WebUSB (same underlying reason as iOS) |

**Linux udev rule** — without this, `requestDevice()` shows the printer but
`device.open()` throws a permissions error, because the USB device node is
owned by root:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="0483", MODE="0666"' | sudo tee /etc/udev/rules.d/99-xprinter.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Replace `0483` with the actual vendor ID for your printer (see §2). Unplug
and replug the printer after reloading rules.

---

## 2. Known Xprinter USB Vendor IDs

| Vendor ID (hex) | Vendor ID (dec) | Notes |
| --- | --- | --- |
| `0x0483` | 1155 | STMicroelectronics chipset — common in Xprinter XP-58/XP-80 series |
| `0x1504` | 5380 | Bulk Ryder Technology — used by some Xprinter/OEM boards |
| `0x04b8` | 1208 | Seiko Epson-compatible chipset, seen on some Xprinter clones |
| `0x0dd4` | 3540 | Custom Solutions/Xprinter-branded chipset |

Xprinter uses several OEM controller boards across its lineup, so the vendor
ID is not fixed — always confirm on the actual unit. Pass all known IDs to
`printReceipt({ vendorIds: [...] })` and let it try each in turn.

**How to find the vendor ID:**

- **Chrome `chrome://device-log`** — plug in the printer, open
  `chrome://device-log` in Chrome, and look for a USB attach event. It shows
  `vendor=0x____ product=0x____`.
- **Windows** — Device Manager → find the printer under "Universal Serial Bus
  devices" or "Ports (COM & LPT)" → Properties → Details tab → property
  "Hardware Ids" → shows `VID_XXXX&PID_XXXX`.
- **macOS** → Apple menu → About This Mac → System Report → USB → select the
  printer → "Vendor ID" field (shown in hex).
- **Android** — install a "USB Device Info" app from the Play Store, connect
  via OTG, open the app and select the printer to see Vendor ID / Product ID.

---

## 3. The Core printReceipt() Function

Complete, copy-paste ready vanilla JavaScript:

```js
// Known Xprinter vendor IDs — see §2 for how to find yours.
const XPRINTER_VENDOR_IDS = [0x0483, 0x1504, 0x04b8, 0x0dd4];

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Build a raw ESC/POS byte sequence from plain text lines.
 */
function buildEscPos(lines, cuts, feedLines) {
  const encoder = new TextEncoder();
  const chunks = [];

  chunks.push(new Uint8Array([ESC, 0x40])); // ESC @ — initialize printer

  for (const line of lines) {
    chunks.push(encoder.encode(line + "\n")); // text + line feed (0x0A)
  }

  chunks.push(new Uint8Array(Array(feedLines).fill(0x0a))); // feed before cut

  if (cuts) {
    chunks.push(new Uint8Array([GS, 0x56, 0x42, 0x00])); // GS V 66 — partial cut
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Print a receipt to an Xprinter ESC/POS thermal printer over WebUSB.
 *
 * @param {Object} options
 * @param {string[]} options.lines - Text lines to print, in order.
 * @param {number[]} [options.vendorIds] - Vendor IDs to try, in fallback order.
 * @param {boolean} [options.cuts] - Cut paper after printing. Default true.
 * @param {number} [options.feedLines] - Blank lines fed before cut. Default 4.
 * @returns {Promise<{success: boolean, error?: string, bytesWritten?: number}>}
 */
async function printReceipt({
  lines,
  vendorIds = XPRINTER_VENDOR_IDS,
  cuts = true,
  feedLines = 4,
} = {}) {
  if (!("usb" in navigator)) {
    return { success: false, error: "WebUSB not supported in this browser" };
  }

  // --- Step 1: get a device. Reuse a previously authorized one if we
  // have it (see §5); otherwise show the picker filtered to our vendor IDs.
  let device;
  try {
    const known = await navigator.usb.getDevices();
    device =
      known.find((d) => vendorIds.includes(d.vendorId)) ??
      (await navigator.usb.requestDevice({
        filters: vendorIds.map((vendorId) => ({ vendorId })),
      }));
  } catch (err) {
    // User closed the picker without selecting a device, or no device
    // matched any of the requested vendor IDs.
    return { success: false, error: `No device selected: ${err.message}` };
  }

  try {
    // --- Step 2: open the device and pick a configuration.
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // --- Step 3: auto-detect the interface + endpoint that supports bulk
    // OUT transfers. Never hardcode interface/endpoint numbers — they vary
    // between Xprinter firmware revisions.
    const iface = device.configuration.interfaces.find((i) =>
      i.alternates.some((alt) =>
        alt.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
      ),
    );
    if (!iface) {
      return { success: false, error: "No bulk OUT interface found on device" };
    }

    const alternate = iface.alternates.find((alt) =>
      alt.endpoints.some((ep) => ep.direction === "out" && ep.type === "bulk"),
    );
    const endpoint = alternate.endpoints.find(
      (ep) => ep.direction === "out" && ep.type === "bulk",
    );

    // --- Step 4: claim the interface. This is where "Unable to claim
    // interface" surfaces if another driver (e.g. Linux's usblp kernel
    // module) already has it — see §7.
    await device.claimInterface(iface.interfaceNumber);
    if (iface.alternates.length > 1) {
      await device.selectAlternateInterface(iface.interfaceNumber, alternate.alternateSetting);
    }

    // --- Step 5: build and send the ESC/POS payload.
    const payload = buildEscPos(lines, cuts, feedLines);
    const result = await device.transferOut(endpoint.endpointNumber, payload);

    await device.releaseInterface(iface.interfaceNumber);
    await device.close();

    if (result.status !== "ok") {
      return { success: false, error: `transferOut failed: status=${result.status}` };
    }
    return { success: true, bytesWritten: result.bytesWritten };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

---

## 4. ESC/POS Quick Reference

| Command | Bytes | Description |
| --- | --- | --- |
| Initialize | `1B 40` (`ESC @`) | Resets printer state/buffer |
| Line feed | `0A` | Newline, advances paper one line |
| Partial cut | `1D 56 42 00` (`GS V 66 0`) | Cuts paper, leaving a small tab |
| Bold on | `1B 45 01` (`ESC E 1`) | Enables bold text |
| Bold off | `1B 45 00` (`ESC E 0`) | Disables bold text |
| Align left | `1B 61 00` (`ESC a 0`) | Left-aligns following text |
| Align center | `1B 61 01` (`ESC a 1`) | Center-aligns following text |
| Align right | `1B 61 02` (`ESC a 2`) | Right-aligns following text |
| Text size | `1D 21 nn` (`GS !`) | `nn` packs width (high nibble) + height (low nibble) multipliers, `0x00`–`0x77` |

---

## 5. Persisting the Printer Connection

`navigator.usb.requestDevice()` always shows the OS picker — only call it
when you don't already have an authorized device. `navigator.usb.getDevices()`
returns devices the user previously authorized for this origin, with no
picker prompt, so call it first and only fall back to `requestDevice()`.

```js
/** Reconnect to a previously authorized printer, no picker shown. */
async function reconnect(vendorIds = XPRINTER_VENDOR_IDS) {
  if (!("usb" in navigator)) return undefined;
  const devices = await navigator.usb.getDevices();
  return devices.find((d) => vendorIds.includes(d.vendorId));
}
```

Authorization is tied to the browser profile + origin and persists until the
user revokes it (`chrome://settings/content/usbDevices`) or unplugs and the
OS reassigns a different device identity. Call `reconnect()` on page load and
only invoke `printReceipt()`'s `requestDevice()` path if it returns nothing.

---

## 6. How to Integrate Into Any Project

**Vanilla HTML/JS**

```html
<button id="print-btn">Print Receipt</button>
<script type="module">
  import { printReceipt } from "./printer.js";
  document.getElementById("print-btn").onclick = async () => {
    const result = await printReceipt({ lines: ["Hello", "World"], cuts: true });
    if (!result.success) alert(result.error);
  };
</script>
```

**React**

```tsx
import { useRef } from "react";
import { printReceipt, getAuthorizedPrinter } from "./printer";

function PrintButton({ lines }: { lines: string[] }) {
  const deviceRef = useRef<USBDevice | undefined>(undefined);

  async function handlePrint() {
    deviceRef.current ??= await getAuthorizedPrinter();
    const result = await printReceipt({ lines, cuts: true });
    if (!result.success) alert(result.error);
  }

  return <button onClick={handlePrint}>Print Receipt</button>;
}
```

**Vue 3**

```vue
<template>
  <button @click="handlePrint">Print Receipt</button>
</template>

<script setup>
import { ref } from "vue";
import { printReceipt, getAuthorizedPrinter } from "./printer";

const device = ref(null);
const props = defineProps(["lines"]);

async function handlePrint() {
  device.value ??= await getAuthorizedPrinter();
  const result = await printReceipt({ lines: props.lines, cuts: true });
  if (!result.success) alert(result.error);
}
</script>
```

---

## 7. Common Errors and Fixes

| Error | Cause | Fix |
| --- | --- | --- |
| "No device selected" | User cancelled the browser's USB picker dialog | Prompt the user to try again; this is not recoverable programmatically |
| "Unable to claim interface" | Another driver already owns it — usually the Linux `usblp` kernel module auto-binding to the printer | `sudo modprobe -r usblp` (temporary) or add a udev rule that blocks the kernel driver for this vendor/product ID (permanent) |
| "transferOut failed" | Endpoint not found, printer powered off, or USB cable/hub dropped the connection mid-transfer | Re-run `reconnect()`, check the printer is powered and cabled directly (not through an unpowered hub), retry |
| "SecurityError" | Page not served over HTTPS or `http://localhost` — WebUSB requires a secure context | Serve over HTTPS in production; `http://localhost` and `http://127.0.0.1` are exempted for local dev |
| "NotFoundError" | None of the given `vendorIds` matched any connected/authorized device | Confirm the printer's real vendor ID (§2) and add it to the `vendorIds` array |
| Printer not showing in picker | Wrong vendor ID in the `filters` array, or printer is off/unplugged | Verify vendor ID via `chrome://device-log` (§2); check physical connection and power |

---

## 8. Testing Checklist

1. Open `chrome://device-log` and confirm the printer's vendor ID is visible when plugged in.
2. Serve the app over HTTPS or `http://localhost` (WebUSB refuses insecure origins).
3. Click print, confirm the OS device picker shows the printer, and select it.
4. Confirm `printReceipt()` returns `{ success: true }` and the printer produces output.
5. Reload the page, click print again — confirm no picker appears (persisted authorization, §5).
6. Unplug and replug the printer, then print again — confirm it reconnects and still works.
7. Print with `cuts: false` and confirm the paper is *not* cut.
8. Print with `cuts: true` and confirm a partial cut occurs after `feedLines` blank lines.
9. On Linux, confirm the udev rule is applied (`ls -l /dev/bus/usb/*/*` shows group/world writable) and printing works without `sudo`.
10. On Android Chrome via USB OTG, repeat steps 3–4.

---

Powered by 5XCODES [5xcodes.com]
