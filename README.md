# Bake-Shop-VVT

Next.js port of the Flutter Bakery POS, built from `../Design/README.md` and
`../Design/Bakery POS.dc.html`. Powered by 5XCODES [5xcodes.com].

## Firebase

Reuses the existing `bake-shop-9f4f0` Firebase project (same config as the
Flutter app — see `.env.local`), but reads/writes a **separate named
Firestore database**, `bake-shop-uat-v2`, so this UAT build never touches
live data. Create it once:

```bash
gcloud firestore databases create --database=bake-shop-uat-v2 \
  --location=<region> --project=bake-shop-9f4f0
```

Hosting target: `bake-shopx` (see `firebase.json` / `.firebaserc`).

### Firestore rules

`firestore.rules` is the source of truth. **The Firebase CLI's array-form
multi-database `firestore` config in `firebase.json` has proven unreliable
for this named database** — `firebase deploy --only firestore:rules` has at
least once silently pushed a stale/deny-all ruleset instead of the real file.
Deploy rules directly via the Rules REST API instead:

```bash
TOKEN=$(gcloud auth print-access-token)
RESP=$(curl -s -X POST "https://firebaserules.googleapis.com/v1/projects/bake-shop-9f4f0/rulesets" \
  -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: bake-shop-9f4f0" \
  -H "Content-Type: application/json" \
  -d "{\"source\":{\"files\":[{\"name\":\"firestore.rules\",\"content\":$(python3 -c 'import json,sys;print(json.dumps(open("firestore.rules").read()))')}]}}")
RULESET_NAME=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin)['name'])")
curl -s -X PATCH "https://firebaserules.googleapis.com/v1/projects/bake-shop-9f4f0/releases/cloud.firestore%2Fbake-shop-uat-v2" \
  -H "Authorization: Bearer $TOKEN" -H "X-Goog-User-Project: bake-shop-9f4f0" \
  -H "Content-Type: application/json" \
  -d "{\"release\": {\"name\": \"projects/bake-shop-9f4f0/releases/cloud.firestore/bake-shop-uat-v2\", \"rulesetName\": \"$RULESET_NAME\"}}"
```

After changing `firestore.rules`, always re-run this (or verify the deployed
content via `GET .../rulesets/{id}`) rather than trusting the CLI output.

### Auth setup (manual, console-side)

1. Firebase Console → Authentication → Sign-in method → enable **Email/Password**.
2. Create the first admin user either from the console (Authentication → Add
   user) or by temporarily running the `createUser` Cloud Function's logic —
   the in-app **Users** page needs an existing admin to call it, so the very
   first account has to be seeded outside the app.
3. After creating that first user in the console, add their Firestore profile
   by hand so they're recognized as admin:
   ```
   users/{uid}  { name, email, role: "admin", active: true }
   ```
   in the `bake-shop-uat-v2` database. From there, that admin can create every
   other user from the Users page.

### Cloud Functions (user management)

`functions/` holds callable functions using the Admin SDK, all admin-gated by
checking the caller's `users/{uid}.role === "admin"` in Firestore:

- `createUser` — creates the Auth account + Firestore profile. Runs
  server-side so the calling admin's own session is never disturbed (the
  client SDK can't create a second user without signing the first one out).
- `updateUser` — edits a user's **name and role only**, never their email
  (an email change would desync Auth from the login flow — out of scope by
  design).
- `resetUserPassword` — sets a new password directly, no email flow.
- `deleteUser` — permanently deletes the Auth account + Firestore profile.
  Refuses to delete the caller's own account.
- `setUserActive` — disables/enables an account without deleting it.

```bash
cd functions && npm install && npm run build
firebase deploy --only functions
```

## Cashier permissions (Settings)

Admins can widen or narrow what a **cashier** account is allowed to do from
`/settings` (admin-only). Backed by a single doc at
`settings/cashierPermissions` in Firestore (see
`src/lib/firestore/permissions.ts`), read live by every client and enforced
in **two places** for each flag — always update both when adding a new one:

1. UI gating in the relevant page (e.g. `src/app/bills/page.tsx` disables the
   Void button unless `profile.role === "admin" || permissions.voidBills`).
2. `firestore.rules` — mirrors the same check server-side via a
   `cashierCan(flag)` helper, so the restriction can't be bypassed by calling
   Firestore directly. Not every flag has a rules-side check yet (e.g.
   `editStockPrices` / `createStockItems` both write to the same `products`
   collection, which the rules currently leave broadly writable to any
   signed-in user and only gate in the UI) — tightening that requires
   splitting `products` writes by field, which Firestore rules can do but
   wasn't worth the complexity yet for a UAT build.

Current flags (defaults in `DEFAULT_PERMISSIONS`):

| Flag | Default | Effect |
| --- | --- | --- |
| `voidBills` | off | Void a bill from Bills (always on for admins) |
| `editStockPrices` | on | Change price-each when adding stock |
| `createStockItems` | off | Add a brand-new product from Stock → New item |
| `logReturns` | on | Log a bakery return from Report or Stock |
| `viewReports` | on | Open the Report screen — not yet wired into a route guard, see below |

`viewReports` is defined but **not yet enforced** — Report currently has no
role/permission gate. Wire it the same way `dashboard/page.tsx` and
`users/page.tsx` gate on `profile.role !== "admin"` if you want it enforced.

## Stock — adding quantity

The Stock edit sheet never lets you type an absolute count. It shows
**Available now** (read-only) and an **Add stock** field — you only type how
much you're adding, and the sheet computes **New total** live
(`available + add`) before saving. This is deliberate: it matches how a
cashier actually works ("50 more came in today"), and prevents someone from
accidentally overwriting the real count by mistyping an absolute number.

New products (Stock → **+ New item**, gated by the `createStockItems`
permission) always start at 0 stock — add real stock afterwards from the
item's row. Categories come from `PRODUCT_CATEGORIES` in `src/lib/constants.ts`
and are shared between Billing's filter chips and this form — add a category
there, not as free text, so the two never drift apart.

## Sales report — date ranges

`/report` has a range selector: **Today / Yesterday / This month / Last
month / Custom**. Implementation notes (`src/lib/dateRanges.ts`,
`src/app/report/page.tsx`):

- Sales stats (Sales, Bills, Avg bill, Unsynced) and the chart are computed
  **client-side** from `useBills()`, which already loads the full `bills`
  collection live — no extra Firestore reads per range change.
- The **Bakery items (in/sold/returned)** table and **Return log** are keyed
  by a single calendar day (`bakeryDays/{date}/items`, `returns` filtered by
  `date`), so they only render when the selected range resolves to exactly
  one day (`range.singleDayKey !== null` — true for Today/Yesterday/a
  single-day Custom range, false for This month/Last month/a multi-day
  Custom range). For multi-day ranges those two sections are hidden rather
  than approximated.
- The chart itself switches shape: single-day ranges show **sales by hour**
  (12 buckets, 8am–7pm); multi-day ranges show **sales by day** across the
  range instead.

Dashboard (`/dashboard`, admin-only) additionally has a **Monthly revenue**
chart — last 6 calendar months, computed the same client-side way from
`useBills()`.

## Splash screen & sidebar

Visual design (splash screen, sidebar/drawer palette, nav icons) was done as
a dedicated polish pass — see `src/components/Splash.tsx`,
`src/components/BrandMark.tsx`, `src/components/AppShell.tsx`, and the dark
surface tokens/gradients/animations added to `src/app/globals.css` (the
`surface-nav`, `surface-ink`, `animate-rise`/`animate-glow`/`animate-sweep`
utilities). Nav icons use `lucide-react`. Keep new dark-surface UI (anything
sitting on the sidebar/drawer/splash/login backgrounds) using those same
tokens rather than inventing new colors, so the app keeps reading as one
system.

## Structure

- `src/app/` — one route per screen: Billing (`/`), Bills, Report, Stock, Dashboard, Users, Settings
- `src/app/login/` — email/password sign-in, with a locally-remembered email dropdown (not from Firebase — client code can't list Auth users)
- `src/components/Splash.tsx` — branded loading screen shown while auth resolves
- `src/components/AuthGate.tsx` — redirects to `/login` when signed out
- `src/components/AppShell.tsx` — minimizable sidebar (desktop) + slide-in drawer (mobile) + bottom nav (core items, kept on every page/breakpoint)
- `src/lib/auth.tsx` — `AuthProvider`/`useAuth()`: Firebase Auth user + Firestore `users/{uid}` profile (role, name)
- `src/lib/emailHistory.ts` — localStorage-only list of emails used to sign in on this device, powers the login dropdown
- `src/lib/firebase.ts` — Firebase init (Firestore `bake-shop-uat-v2` database, Auth, Functions)
- `src/lib/firestore/` — Firestore hooks/writers (`products.ts`, `bills.ts`, `bakeryDays.ts`, `returns.ts`, `users.ts`, `permissions.ts`)
- `src/lib/dateRanges.ts` — Today/Yesterday/This month/Last month/Custom range resolution for Report
- `src/lib/constants.ts` — shared `PRODUCT_CATEGORIES`
- `src/lib/printer.ts` — WebUSB ESC/POS printing; full reference in `docs/webusbXprinter.md`
- `src/lib/types.ts` — Firestore document shapes (products, bills, returns, bakery day items)
- `functions/` — Cloud Functions for admin user management

## Dev

```bash
npm run dev      # http://localhost:3000
npm run build    # static export to out/ (output: "export" in next.config.ts)
firebase deploy --only hosting:bake-shopx,functions
```

## Migrating to live

Everything UAT-specific lives in a few known places — flip these when
cutting over to the real production Firebase project/database:

1. **Firestore database** — `NEXT_PUBLIC_FIRESTORE_DATABASE_ID` in
   `.env.local` and the matching `FIRESTORE_DATABASE_ID` constant in
   `functions/src/index.ts` (currently both `bake-shop-uat-v2`). Point both
   at the live database id, and create it first if it doesn't exist yet
   (same `gcloud firestore databases create` command as above).
2. **firestore.rules / firestore.indexes.json** — `firebase.json`'s
   `firestore[0].database` field and the release path in the deploy snippet
   above (`cloud.firestore/bake-shop-uat-v2`) both need to change to the live
   database id.
3. **Hosting site** — `firebase.json`'s `hosting.site` (currently
   `bake-shopx`) and `.firebaserc`'s `targets` block, if the live site has a
   different Firebase Hosting site id.
4. **Firebase project itself** — if live runs in a *different* Firebase
   project (not just a different database in the same project), every value
   in `.env.local` (`NEXT_PUBLIC_FIREBASE_*`) changes, `.firebaserc`'s
   `projects.default` changes, and Cloud Functions need redeploying into that
   project.
5. **Seed data** — the live database starts empty like this one did. Re-seed
   the first admin user's Firestore profile by hand (see Auth setup above)
   and re-create `settings/cashierPermissions` from Settings, since neither
   is copied automatically between databases/projects.
6. Nothing in the app code itself is UAT-specific — no `if (uat)` branches —
   so once the above config points at live, the same build is production-ready.
