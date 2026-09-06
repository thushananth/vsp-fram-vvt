# Customers, credit bills and cost price

Four things the Flutter app (`5x/bake_shop`) had and this one did not, now
built:

1. **Cost price** on stock items, so margin is knowable.
2. **Customers** with a running credit balance.
3. **Credit bills** — pick a customer at checkout, don't take cash.
4. **A credit payment screen** — a customer walks in and settles some or all of
   what they owe.

Plus: the existing `customers` and `stocks` data in the Flutter app has to end
up here eventually. **Nothing has been copied yet** — the script is written and
dry-runs, but has not been pointed at the real data.

## The two databases

Both apps live in the **same Firebase project** (`bake-shop-9f4f0`) but in
**different Firestore databases**:

| App | Database | Collections of interest |
| --- | --- | --- |
| Flutter (`5x/bake_shop`) | `(default)` | `customers`, `stocks`, `bills`, `bill_items`, `credits` |
| This app (`bake-shop-vvt`) | `bake-shop-uat-v2` | `customers`, `products`, `bills` |

Same project means a migration script authenticates once and reads both — no
export/import dance, no service-account juggling. See **Migration** below.

## Decisions

These are settled here so the code does not have to re-litigate them.

**Bills own the debt; `credits` is not copied.** The Flutter app keeps both
`bills.paidAmount`/`paymentStatus` *and* a parallel `credits` collection. Two
sources of truth for one number, which is why the bill-status update in
`credit_payment_screen.dart` is commented out — it could not be kept honest. We
put `paid` and `due` on the bill itself. `creditPayments` is an append-only
receipt log, never the balance.

**`customer.remainingCredit` is a cache.** The truth is `sum(bills.due)` plus
`openingBalance`. The field exists because the customer list has to sort and
filter on it without reading every bill, and because the Flutter data arrives
with it already populated.

**Migrated balances need `openingBalance`.** We copy `customers` but not their
`bills`. So every migrated customer arrives owing money with no bill behind it.
If the payment screen could only settle bills, those balances would be
permanently unpayable. `openingBalance` is a settleable synthetic line, shown as
*"Opening balance (before migration)"*, always allocated **last**.

**No customer means `customerId: null`.** The Flutter data has a walk-in
placeholder customer detectable by `mobileNumber == '0000000000'` — the credit
screen filters it out by hand. We do not carry a sentinel document; a cash sale
to nobody has `customerId: null`. The migration skips that doc.

**Field names follow the Flutter shape where it is free to do so.**
`costPrice` and `remainingCredit` keep their names so `customers` is a
zero-transform copy. `stocks` → `products` needs a mapping table regardless.

**Cost price is admin-only.** Gated on `isAdmin`, not on a new permission flag.
`permissions.editStockPrices` stays what it is — the *selling* price.

**Payment allocation is one transaction.** The Flutter version is a loop of
sequential awaits with a read-modify-write on the customer balance; a dropped
connection halfway leaves the books wrong. `bills.ts:createBill` already shows
the right shape here — one `runTransaction`, every read before the first write.

## Data model

### `products` — two new fields

| Field | Type | Notes |
| --- | --- | --- |
| `costPrice` | `number` | What we paid. Default `0`. Admin-visible only. |
| `unit` | `string` | `"pieces"`, `"kg"`… Flutter has it; we would drop data without it. |

`Product` in `src/lib/types.ts` gains both. `createProduct` takes `costPrice`
and `unit`. Never shown to a cashier.

### `customers` — new collection

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | |
| `type` | `"shop" \| "person"` | Flutter's own two values. |
| `mobileNumber` | `string` | |
| `remainingCredit` | `number` | Cached total owed. |
| `openingBalance` | `number` | Debt carried in from the Flutter app. `0` for customers created here. |
| `active` | `boolean` | Soft delete — a customer with history is never removed. |
| `createdAt` / `updatedAt` | `number` (ms) | This app uses epoch millis, not `Timestamp`. |

### `bills` — new fields

| Field | Type | Notes |
| --- | --- | --- |
| `customerId` | `string \| null` | `null` for a walk-in cash sale. |
| `customerName` | `string \| null` | Denormalised so the bills list needs no join. |
| `paymentType` | `"cash" \| "credit"` | Existing bills read as `"cash"`. |
| `paid` | `number` | Cash paid at the till. For a credit bill, usually `0`. |
| `due` | `number` | `total - paid`. `0` on a cash sale. Drops to `0` as payments land. |

`tender` and `change` stay meaningless-but-present on a credit bill (`0`).

### `creditPayments` — new collection

Append-only. One document per payment event, however many bills it touched.

| Field | Type | Notes |
| --- | --- | --- |
| `customerId` | `string` | |
| `customerName` | `string` | |
| `amount` | `number` | Total taken. |
| `method` | `"cash"` | Room to grow; only cash today. |
| `allocations` | `{ billId, billNo, amount }[]` | Includes `{ billId: null, billNo: null }` for the opening-balance share. |
| `receivedBy` | `string` | uid. |
| `createdAt` | `number` (ms) | |
| `note` | `string \| null` | |

## How payment works

`payCredit({ customerId, amount, receivedBy, note })`, one `runTransaction`:

1. **Read everything first** — the customer doc, and that customer's bills with
   `due > 0` ordered oldest-first. (Firestore forbids a read after the first
   write in a transaction; `bills.ts:38` already carries this note.)
2. Reject `amount <= 0` or `amount > remainingCredit`.
3. Allocate **oldest bill first**. Each bill takes `min(remaining, bill.due)`.
4. Anything left over goes against `openingBalance`, last.
5. Write: each touched bill's `paid`/`due`; the customer's `remainingCredit` and
   `openingBalance` as **values computed inside the transaction** (not
   `increment` — the read already happened, and mixing the two invites drift);
   one `creditPayments` document.

Overpayment is refused rather than parked as a negative balance. A shop that
wants to hold an advance can wait until someone asks for it.

## UI

### Stock (`src/app/stock/page.tsx`)

Cost price in the new-item form (~L240-260) and in the edit sheet (~L480-530),
next to "Price each", **behind `isAdmin`**. Margin shown inline as a hint
(`price - costPrice`) — that is the whole reason cost price is being added, and
it costs nothing to render it where it is being typed.

### Customers (`src/app/customers/page.tsx`)

List with search by name or mobile, outstanding balance per row, and an
add/edit sheet. A row opens that customer's statement — credit bills, payments,
and the opening balance if any.

The statement is a **sheet, not a `/customers/[id]` route**: `next.config.ts`
sets `output: "export"`, and a dynamic route under static export would need
`generateStaticParams`, which cannot enumerate customers at build time. Sheets
are what the rest of the app uses anyway.

Not admin-only — a cashier taking a credit sale needs to add a customer at the
till. Not in `CORE_HREFS`; it lives in the sidebar, not the bottom bar.

### Billing (`src/app/page.tsx`)

A customer picker above the totals: *Walk-in* by default, searchable, with
"+ New customer" inline. Two buttons instead of one — **Cash** and **Credit**.

The current charge button is disabled on `tender === null` (L203) and
`completeSale` returns early on the same condition (L62). Credit sales have no
tender, so that gate has to move onto the cash path only, not the shared one.
Credit is disabled unless a customer is selected. The receipt for a credit bill
prints the customer name, `Due` instead of `Tender`/`Change`, and their new
running balance.

### Credit (`src/app/credit/page.tsx`)

Customers with a balance, biggest first. Pick one → their outstanding bills
oldest-first with the opening balance as its own line → enter an amount →
allocation preview (which bills this clears) → confirm. Also lists that
customer's past payments.

Quick "settle all" fills the full balance. Payment history for the shop overall
lives here too, so an admin can see the day's collections.

Not in `CORE_HREFS`. Visible to cashiers — taking money is a till job.

## Rules and indexes

```
match /customers/{id} {
  allow read: if isSignedIn();
  allow write: if isSignedIn();
}

match /creditPayments/{id} {
  allow read: if isSignedIn();
  allow create: if isSignedIn();
  allow update, delete: if false;   // append-only
}
```

`bills` allowed `create` by anyone signed in and `update` only behind
`isAdmin() || cashierCan('voidBills')`. Credit payment updates bills, so that
rule now also allows an update whose `affectedKeys()` are `paid`/`due` and
nothing else — voiding, which changes `status`, still needs the permission.

`firestore.indexes.json` stays empty. The outstanding-bills lookup filters on
`customerId ==` alone and sorts and filters `due` in JS — a single-field query
needs no composite index, and one customer's bills are few. This follows what
`adminEmails()` in `functions/src/devices.ts` already does for the same reason.
Nothing to deploy.

A cashier can write `customers` directly, so a cashier can zero a balance by
hand. That is already true of `products` and `bills` here, so it is not a new
kind of trust. If the books ever need to be tamper-evident, `payCredit` moves
into a callable function in `functions/` — the shape above ports over unchanged.

## Migration

**Not now.** Written down so the schema above stays honest.

A one-off Node script under `functions/scripts/` (never shipped in the
deployed bundle), Admin SDK, two `getFirestore()` handles — `(default)` for the
Flutter data, `bake-shop-uat-v2` for ours. Dry-run flag that prints counts and
mappings without writing. **Source document IDs are preserved** — if bills ever
follow, they will refer to customers by the old IDs.

`customers` → `customers`, near-identity:

| Source | Target | Note |
| --- | --- | --- |
| `name`, `type`, `mobileNumber` | same | |
| `remainingCredit` | `remainingCredit` | |
| — | `openingBalance` | **set to `remainingCredit`** — the debt has no bills here |
| — | `active` | `true` |
| `createdAt`/`updatedAt` (`Timestamp`) | same (millis) | `.toMillis()` |

Skip `mobileNumber == '0000000000'` (the walk-in placeholder).

`stocks` → `products`:

| Source | Target | Note |
| --- | --- | --- |
| `name` | `name` | |
| `unitPrice` | `price` and `lastPrice` | |
| `costPrice` | `costPrice` | |
| `quantity` | `onShelf` | |
| `code` | `barcode` | `null` if empty |
| `unit` | `unit` | |
| `category` | `category` | |
| `expiryDate` | `expiryDate` | `Timestamp` → `YYYY-MM-DD` string |
| `status` | — | dropped; derived here from `onShelf` vs `minLevel` |
| `imageUrl` | `imageUrl` | **carried across.** Products have photos here now — see `docs/billingAndImages.md`. The field keeps the Flutter name so the copy is a straight assignment. |
| — | `isBakery` | **needs a call.** Flutter has no such flag. Probably `category`-driven; confirm against the real data before running. |
| — | `active` | `true` |
| — | `minLevel`/`maxLevel` | `null` |

Re-runnable: same IDs, `set` with merge, so a second run corrects rather than
duplicates. Verify by count and by spot-checking the ten largest balances
against the Flutter app before pointing anyone at the new till.

## Verified

`firestore.rules` was exercised against the Firestore emulator
(`firebase emulators:exec --only firestore`) with
`@firebase/rules-unit-testing` — 13 cases, all passing:

- a **cashier** can move `paid`/`due` on a bill, update the customer's cached
  balance, and append a `creditPayments` receipt — the whole credit-payment
  transaction, which is the path that would otherwise fail only in the shop;
- a cashier **cannot** void a bill (a `status` change) while `voidBills` is off,
  and cannot smuggle another field in alongside `paid`/`due`;
- an admin can void;
- a cashier can create a credit bill and add a customer mid-sale;
- `creditPayments` cannot be edited or deleted by anyone, admins included;
- signed-out access is refused throughout.

The allocation maths (`outstandingLines`, `allocate`) and `payCredit` itself
have not been run against real data yet — the first credit sale and payment in
the app are still worth watching.

## Out of scope

- **Margin and profit reporting** in `report` / `dashboard`. `costPrice` makes
  it possible; it is its own piece of work.
- **A printed credit-payment receipt.** The Flutter app has
  `printCreditPaymentReceipt`; `src/lib/printer.ts` would need the equivalent.
  The screen works without it.
- **Credit limits per customer**, statements, ageing buckets, interest.
- **Copying `bills`, `bill_items` or `credits`** from the Flutter app.
  `openingBalance` exists precisely so this is not required.

## What was built

| File | What changed |
| --- | --- |
| `src/lib/types.ts` | `Product.costPrice`/`unit`; `Bill.customerId`/`customerName`/`paymentType`/`paid`/`due`; new `Customer`, `CreditPayment`, `CreditAllocation` |
| `src/lib/firestore/products.ts` | `costPrice`/`unit` on create, defaulted on read for older docs |
| `src/lib/firestore/bakeryDays.ts` | `costPrice` persisted through both stock-save paths |
| `src/lib/firestore/customers.ts` | new — CRUD, soft delete, search |
| `src/lib/firestore/bills.ts` | credit fields on create, customer balance in the same transaction, `useCustomerBills` |
| `src/lib/firestore/credit.ts` | new — `outstandingLines`, `allocate`, `payCredit`, `useCreditPayments` |
| `src/app/stock/page.tsx` | cost price + unit + live margin, admin-gated |
| `src/app/customers/page.tsx` | new — list, add/edit sheet, statement sheet |
| `src/app/credit/page.tsx` | new — Collect and History tabs |
| `src/app/page.tsx` | customer picker, Cash/Credit split, credit receipt |
| `src/app/bills/page.tsx` | Credit filter, customer name, due on the receipt |
| `src/components/AppShell.tsx` | Customers and Credit in the sidebar |
| `firestore.rules` | `customers`, append-only `creditPayments`, narrowed bill update |
| `functions/scripts/migrate-from-flutter.js` | new — dry-run by default |

Reading a bill or product written before this change fills the new fields with
safe defaults (`paymentType: "cash"`, `paid: total`, `due: 0`, `costPrice: 0`),
so nothing needs backfilling.
