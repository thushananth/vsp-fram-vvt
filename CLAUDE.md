@AGENTS.md

# VSP Farm POS (Chicken Farm POS)

Till, bills, credit and reports for a chicken farm shop in Sri Lanka. Cashiers use it all day on
a **tablet held in portrait**; admins also use a laptop. Money is shown as `Rs 1,234` via
`money()` in `src/lib/format.ts`. Weights are kg to 3 decimals.

## How it runs

- **Static export** (`output: "export"` in `next.config.ts`), hosted on Firebase Hosting. There is no
  server: every page is a client component that talks to Firestore directly.
- **Firestore offline persistence** (`src/lib/firebase.ts`). The SDK queues writes while the wifi is down.
- **Service worker** (`scripts/generate-sw.mjs`, written at build time) precaches the whole export so
  the till can boot offline. Pages are network-first with a 2.5s timeout; `/_next/` chunks are cache-first.
- Cloud Functions live in `functions/` (SMS, device approval emails).

## Rules for changes

- **Don't change business logic when the task is UI or loading.** That covers billing maths, credit
  allocation, bill numbering, the bill journal, permissions and receipts. Ask first.
- **Deploy only when the user explicitly says "deploy".** Building is fine; `firebase deploy` is not.
- Don't commit unless asked.

## Security rules

- Every data rule asks for **`isStaff()`** (a `users/{uid}` profile made by `createUser`, not switched off),
  never just `request.auth != null`: the API key is public, so anyone can make a Firebase Auth account.
- Rules check **shape, not maths**. Bills and balance increments are written offline and the rules run when
  they flush, so anything stricter than "fields present, right types" can refuse a real sale.
- **App Check** (reCAPTCHA Enterprise, key "VSP Farm") starts from `RootShell` after mount via
  `startAppCheck()`, never at import (hydration would remove reCAPTCHA's element). It only runs on the hosts in
  `APP_CHECK_HOSTS`, which must match the key's allowed domains in Google Cloud. The floating badge is hidden
  in CSS; the required "Protected by reCAPTCHA" notice is on the sign-in screen (`RecaptchaNotice`).
- `npm run test:rules` replays the till's real writes (sales, the bill-number lease, payments, voids, send-out)
  plus the refusals. Run it after any change to `firestore.rules` or `storage.rules`, and add a case for any
  new client write.

## Advance orders

- `orders/{id}`: placed, edited, cancelled and reopened only through the `placeOrder` / `updateOrder`
  callables (`functions/src/orders.ts`), which number them (`counters/orders`) and write `orders/{id}/log`.
  Editing or cancelling is admin-only.
- The client makes two moves only: **send out** (one batch: the OR- bill with id `${orderId}-${sendSeq}`,
  the order to `out`, the balance increment; see `createBill({ order })`) and **delivered**. The rules refuse
  either half of the send-out without the other.
- OR- bills are normal credit bills with `kind: "order"` and `no = orderNo`. Print bill numbers with
  `billLabel()` (`src/lib/orders.ts`), never `#${bill.no}`.
- `onOrderStatusChanged` logs out/delivered, updates the public `orderTracking/{token}` copy and texts the
  customer. `orderAlertTomorrow` (16:00) and `orderAlertMorning` (06:00, Asia/Colombo) text the numbers set in
  Settings → Orders. Every order SMS has its own switch; defaults live in both `settings.ts` and `orders.ts`.
- The customer's track page is `public/t.html` + `t.js` (no app bundle, no login), reading `/api/track`
  (the `trackOrder` function, Hosting rewrite). Firestore stays closed to the public.
- `npm run test:orders` runs the whole flow on the emulators. It refuses to start if
  `functions/.secret.local` exists, since the emulator would then send real SMS.

## Data loading: read this before adding a hook

All Firestore reads that drive UI go through **`useLive(key, open)` in `src/lib/firestore/live.ts`**.
Never call `onSnapshot` straight from a component or a new hook's `useEffect`.

- One listener per query key, shared by every screen that asks for it. A screen opened a second time
  gets the cached result on its first render, so there is no spinner.
- An unused listener stays open for 10 minutes (`LINGER_MS`), so moving between pages is instant.
- Everything is dropped when the signed-in user changes. Cashier and admin share a tablet, and cost
  prices or user lists must not carry over.
- **The key must encode everything that changes the query** (collection, filters, range,
  `includeMetadataChanges`). Two different queries under one key would share wrong data.
- Keep the hook's public return shape (`{ products, loading }` and so on). Pages depend on it.
- Use a module-level empty constant (`const NO_BILLS: Bill[] = []`) for the "nothing yet" value, never
  a fresh `[]`, so memoised values downstream stay stable.
- **Always query a date range** for `bills` and `creditPayments` (`resolveRange` in
  `src/lib/dateRanges.ts`). Each document is a billed read, and the history holds thousands.
  Ranges are day-aligned, so keys stay stable across renders.
- `useDeviceApproval` deliberately stays on its own listener (DeviceGate needs `fromCache` and `denied`).

## Loading and navigation feel

The target is "nothing ever looks stuck":

- `Splash` is for cold boot only (AuthGate). A page waiting for its own data must never cover the
  whole screen.
- First-load placeholders are **skeletons** shaped like the content (`src/components/ui/Skeleton.tsx`).
  Don't use "Loading…" text. They and `PageLoading` fade in only after ~200ms (`.skeleton-in`), so fast
  loads show nothing.
- Nav links render `<NavPending />` inside the `<Link>`. It uses `useLinkStatus` to tint the tapped item
  and show the top `.route-progress` bar if the route takes longer than ~120ms.
- `AppShell` prefetches every route the user's role can reach when the browser is idle, because the
  drawer's links aren't mounted and so are never prefetched by `<Link>`.
- `src/app/template.tsx` gives each page a 180ms **opacity-only** fade. Never animate `transform` on a
  page wrapper: it becomes the containing block for the pages' `position: fixed` sheets and bars.
- Respect `prefers-reduced-motion` for every animation (see the end of `globals.css`).
- In `next dev` the first visit to a route compiles on demand and can take seconds. Judge smoothness on
  a production build (`npm run build`, then serve `out/`), not on dev.

## UI conventions (tablet first)

- Design for an **800 × 1280 portrait tablet** first, then phone, then desktop.
- Touch targets at least 44px; primary actions 48–64px. Charge is the single loudest button on Billing.
- Use the colour tokens in `src/app/globals.css` (`ink`, `ground`, `surface`, `border`, `accent`,
  `success`, `warning`, `danger`, `muted`, `ink-*`, `nav-*`). Don't introduce new hex colours in
  components.
- Amounts use `tabular-nums`.
- The on-screen `NumPad` is used for money and quantity entry, so the system keyboard never covers the
  basket.

## Commands

```bash
npm run dev      # local dev (slow first visit per route, that's normal)
npm run build    # next build + generates out/sw.js
npm run lint
npx tsc --noEmit
npm run test:rules   # Firestore + Storage rules on the emulator
npm run test:orders  # advance orders end to end (auth, firestore, functions emulators)
```

`npm run lint` has a few older `react-hooks/set-state-in-effect` errors (AppShell, auth, online,
login) that predate the loading work.
