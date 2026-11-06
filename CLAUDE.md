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
```

`npm run lint` has a few older `react-hooks/set-state-in-effect` errors (AppShell, auth, online,
login) that predate the loading work.
