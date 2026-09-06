# Selling with no connection

The shop's wifi drops. A bill taken during the outage must not be lost, must
still print, and must reach Firestore on its own once the link comes back —
and the cashier must be able to get those bills off the till by hand if
anything goes wrong.

## What was broken

Offline persistence was already switched on (`persistentLocalCache` in
`src/lib/firebase.ts`), which made it *look* covered. It wasn't:

- **`createBill` used `runTransaction`.** A Firestore transaction is a server
  round-trip — it has no offline form. With the wifi down the promise never
  settled, so Charge spun forever and the sale was lost.
- **The `synced` flag was a stored `true`.** A document can't know whether it
  reached the server, so the "Queued" filter on Bills could never match
  anything.
- **`createdAt` was `serverTimestamp()`.** On an offline bill that resolves to
  the moment the wifi returned, not the moment the customer paid, and it reads
  back as `0` until then.
- **No service worker.** The queued writes survived a reload; the *app* did
  not. With `output: "export"` and no cached shell, a cashier who reloaded
  mid-outage got a browser error page and no till at all.

## What replaced it

### The write: a batch, not a transaction

`writeBatch` applies to the local IndexedDB cache immediately and flushes when
the connection returns — `runTransaction` cannot. `createBill` now returns as
soon as the write is queued, and the till treats *that* as the sale being
complete. Everything it touches beyond the bill itself uses `increment()`, so
two tills that were both offline merge instead of overwriting each other:

| Field | Before | Now |
| --- | --- | --- |
| `bakeryDays/{date}/items/{id}.sold` | read, add, write | `increment(qty)` |
| `customers/{id}.remainingCredit` | read, add, write | `increment(total)` |

The commit promise is **never awaited** on the till path. Offline it doesn't
reject, it simply never settles — awaiting it is precisely the hang this
change removes. `createBill` hands it back as `accepted` and the POS page
watches it in the background to upgrade the on-screen message.

Re-sending a bill the server refused is guarded by an in-flight map, because
`increment()` is not idempotent: a second batch under the same bill id would
double the day's sold count and the customer's balance.

`paid` is carried on the draft, in the journal and in the CSV, and `due` is
derived from it in exactly one place (`settlement` in `bills.ts`). A part-paid
bill re-sent from the journal would otherwise come back as owing its whole
total — losing real money on the very path that exists to not lose any.

### Bill numbers: leased in blocks

`counters/bills` can't be read-then-written without the network, so a device
no longer asks for a number per sale. It **leases a block of 500** while it is
online (`src/lib/billNumbers.ts`) and hands them out from `localStorage`,
topping up whenever it is online and under 200 remaining. Two devices can't
collide because the lease itself is taken in a transaction, and the numbers
stay short and human-readable on the receipt — unlike a device-prefixed id.

Gaps in the sequence are expected and fine. A bill numbered outside a real
lease (a device that burned through its whole block offline) is written with
`provisionalNo: true`.

### `synced` comes from the snapshot, not the document

`toBill` now derives it from `metadata.hasPendingWrites`, and every bills
listener passes `{ includeMetadataChanges: true }` — **without that option the
listener never re-fires when a queued write is acknowledged**, and the Queued
badge would never clear. The stored `synced: true` field is still written,
because the Flutter app reads it.

### The journal: for writes the server *refuses*

Firestore's own queue is durable, so this is not a second source of truth. It
covers the one case that queue can't: a queued write **rejected** on flush —
an expired token, a de-approved device, a rules change. Firestore drops such a
write silently, and the sale would be gone.

`src/lib/billJournal.ts` keeps a plain-text copy of every bill in
`localStorage`, keyed on the client-generated document id so a re-send
overwrites rather than duplicates. Entries are removed the moment the server
acknowledges them, so in normal use the journal sits empty. A rejected one
turns into a red **"the server refused"** panel at the top of Bills, with
**Re-send** and **Export held** on it.

### Export

Bills → **Export CSV** / **JSON** downloads exactly what the current filter
shows, straight from memory with no network call. Pick the **Queued** filter to
get just the offline takings. CSV carries a UTF-8 BOM so Excel doesn't mangle
customer names; JSON is the lossless copy for rebuilding a bill by hand.

### Booting offline

`scripts/generate-sw.mjs` runs after `next build` and writes `out/sw.js` with
the whole export precached (~2 MB, ~100 files) — the chunk names are content-
hashed, so the list has to be generated rather than hand-written. Navigations
and `_next/*` assets are served **cache-first** with a background refresh, so
the till opens instantly and a deploy lands on the next load.

Cross-origin requests are never intercepted: Firestore, Auth and the callable
functions do their own offline queueing and the worker must stay out of it.

`firebase.json` serves `/sw.js` with `no-store`, or a deploy could never
replace the worker holding the old shell.

## What stayed online-only, on purpose

Voiding a bill (`voidBill`) and settling credit (`payCredit`) still run in
transactions. Both are back-office corrections that can wait for a connection
in a way that a sale at the counter cannot, and the clamped give-back in each
(`Math.max(0, …)`) has no commutative, offline-safe form.

Because Firestore stays silent rather than failing when it can't reach the
server, both are wrapped in `requireServer` (`src/lib/requireServer.ts`), which
puts a 12-second deadline on the wait and turns the silence into an error the
cashier can act on. `navigator.onLine` is **not** used for this — weak shop
wifi reports "online" while nothing gets through, so it drives display only.

## Known limits

- **A sale can create a day-item that had no intake.** Which lines come off the
  bakery shelf is decided on the POS page from `product.isBakery` and passed
  into `createBill` — the old code read the day's items back first, which would
  be empty on a till that didn't record this morning's intake and would skip
  the decrement silently. Selling something never booked in now creates the
  day-item with `received: 0`, which is the honest reading.
- **Bill-number collisions are possible but unlikely.** They need a device to
  exhaust a 500-number block while offline *and* another device to have taken
  the overlapping block. A duplicate number is recoverable; a refused sale is
  not, so the till keeps counting.
- **Two tabs on one browser share the lease** through `localStorage` with no
  lock. The read-modify-write window is sub-millisecond; a POS rarely runs two
  tills in one browser.
- **A device must be online once** before it can sell — `DeviceGate` needs a
  round-trip to approve a new browser.

## Testing it

Build first (`npm run build && npx serve out`, or deploy) — dev has no service
worker. Then, in Chrome DevTools → Network → **Offline**:

1. Charge a cash sale. It should confirm immediately, print, and show
   `· queued` after a couple of seconds. The pill in the header counts it.
2. Reload the page. The app should still open, and the bill should still be
   listed under **Queued**.
3. Bills → Queued → **Export CSV**. The file downloads with no network.
4. Go back online. The queued count drops to zero and the badge flips to Paid
   without a reload — that is `includeMetadataChanges` doing its job.
