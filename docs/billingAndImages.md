# Editing a line, paying part of a bill, and product photos

Three changes to the till, all asked for after the first day on the shop
tablet.

## Tap a line to edit it

The bill rows at the bottom of the billing screen are now buttons. Tapping one
opens a sheet with **quantity** and **price each** as typed fields, plus
Remove.

Both are typed rather than stepped on purpose: a cashier selling twelve of
something shouldn't press `+` eleven times, and a haggled price has no natural
step at all. The `−`/`+` buttons stay on the row itself for quick nudges.

Changing the price affects **this bill only** — the product's own price is
untouched, because an override at the counter is not a price change. When the
two differ, the line records `listPrice` alongside `price`, so a discount is
visible in the bill history rather than silently baked into the total. Lines
sold at list price carry no `listPrice` at all, so an override stands out.

Tapping a **tile in the grid** also opens the sheet, adding the product first —
so a regular getting a bun at 100 instead of 120 is arranged in one movement
rather than two separate taps. A **barcode scan deliberately skips the sheet**:
that is the fast lane, and a modal on every beep would make scanning unusable.

The price field has its own permission, `editBillPrices` ("Change a price on the
bill" in Settings → Cashier permissions), separate from `editStockPrices`. A
shop may well want a cashier to discount a bun for a regular without letting
them reprice the product itself. It defaults to **on**.

## Paying part of a bill

The payment area now has a **typed amount** as well as the Exact/500/1000/2000
chips. There was previously no way to enter 500 against an 800 bill at all.

What happens when the amount is short of the total depends on who is buying:

| Who | Amount | Result |
| --- | --- | --- |
| Anyone | ≥ total | Normal cash sale. Change shown. |
| **Walk-in** | < total | **Blocked**, with a warning naming the shortfall. Nobody would be on the hook for the rest. |
| **A customer** | < total | Confirmation sheet showing bill total, paid now, owing, and their balance after. Confirm and it saves. |
| A customer | Credit button, Paid empty | The whole bill on their account, nothing taken. |
| A customer | Credit button, Paid filled | Treated exactly like Charge — the typed amount is never discarded. |

A part-paid bill is stored with `paid` = what was handed over and
`due` = the rest, and **only the `due` goes onto `remainingCredit`** — not the
whole total. Its `paymentType` is `credit`, so it appears on the credit screens
and can be settled there like any other debt.

`createBill` still refuses a bill with money owing and no customer, but that is
a backstop: the UI blocks it first so the cashier reads a warning, not an error
banner.

The **Credit** button deliberately respects a filled-in Paid field rather than
overriding it with 0. Ignoring it would write `paid: 0, due: 800` on a bill
where Rs 500 was already on the counter — cash the shop would never see again.

Note the Sales report totals `bill.total`, i.e. the **value sold**, not the cash
taken. A part-paid 800 bill counts 800 towards sales; the 300 still owed shows
on the credit screens.

## Product photos

Products carry an `imageUrl`, named to match the Flutter app's `stocks.imageUrl`
so the migration can copy the URL straight across.

**Shown** on the billing grid (square photo above the name — the point is
picking a bun by sight), on the cart rows, in the line sheet, and on both stock
lists. Anything without a photo falls back to the first letter of its name, so
the grid stays even rather than ragged.

**Added** from the Stock screen:

- *Existing item* — the photo uploads the moment it is chosen, separately from
  Save. Waiting for Save would mean a cancelled sheet silently discarded an
  upload that had already happened.
- *New item* — held locally and previewed from an object URL, then uploaded
  once the product has an id. If that upload fails the item is still created;
  only the picture is lost, and the sheet says so.

`<input capture="environment">` opens the tablet camera directly while still
allowing the gallery on a desktop browser.

Photos are **downscaled to 640px / JPEG 82% in the browser before upload**
(`src/lib/productImages.ts`). A tablet camera shot is 4000px and about 4 MB; the
grid renders it at roughly 100px, and a shop on weak wifi cannot spend 4 MB on
a picture of a bun. `storage.rules` caps uploads at 2 MB independently, because
the rules cannot trust the client to have resized anything.

Replacing or removing a photo deletes the old object, but **only if the URL
belongs to this project's bucket**. A migrated Flutter URL is left alone:
`ref(storage, url)` on a foreign URL can resolve by path against this bucket and
delete the wrong object rather than failing.

### Offline

Uploading needs the network — Firebase Storage has no offline write queue, the
way Firestore does. That is fine: adding a photo is a back-office job at the
stock screen, never something a sale waits on.

Photos already uploaded **do** show offline. The service worker makes one
deliberate exception to its never-touch-cross-origin rule and caches Firebase
Storage responses, in a separate `bakeshop-images` cache that `activate` does
**not** sweep — otherwise every deploy would wipe the shop's product photos
until the tablet was next online. It holds 400 images, oldest dropped first,
and keys on the URL without its query string so a re-issued download token
doesn't orphan the copy already stored.

### Deploying

Storage rules are a separate target — a hosting-only deploy will not ship them:

```
firebase deploy --only hosting,storage
```


## Finding one product out of three hundred

A three-column grid and a `<select>` of the whole catalogue both stop working
somewhere around fifty products. Two changes:

- **Billing** — the top field now searches by **name as well as barcode**, and
  filters the grid live. Enter on an exact barcode adds straight to the bill
  (scanner behaviour); Enter on a search narrowed to one product opens its
  sheet, because a person typing is choosing, not scanning.
- **`ProductPicker`** (`src/components/ProductPicker.tsx`) — a full-height sheet
  with search, photos and prices, used by the returns form. It takes
  `suggestedIds` to float the handful that are actually likely to the top, so
  the common case needs no typing at all.

## Returns moved to their own page

`/returns`. It used to be a form at the bottom of Report whose product field was
that unusable `<select>`. The new page has its own date picker, unit and
by-reason totals, the day's log with photos, and a picker that floats **the
items taken in on that day** to the top — those are what actually come back.

Report keeps a link across to it. `logReturn` is a transaction, so it is wrapped
in `requireServer` like the other online-only writes.

## Profit

`/profit`, admin-only — it shows what the shop pays for stock, so it stays off
the till. Same date ranges as the sales report, plus:

- Revenue, cost of goods, profit and margin % for the range.
- A per-product table sorted by profit, with a search box.
- A callout for anything sold **at a loss**, which in practice means a cost
  price that was never filled in.

Profit is measured line by line against **`costPrice` as stamped on the bill
line at the moment of sale**. `BillLine` now carries it. Reading cost off the
product instead would silently re-price last month's margin every time the
bakery changes what it charges. Bills written before this existed fall back to
the product's current cost and are **marked estimated** in the table and in a
banner, rather than being quietly counted as pure profit.

Note the Sales report still totals `bill.total` — value sold, not cash taken.

## The deploy that never arrived

The first version of the service worker served navigations **cache-first**. That
made the till boot instantly, and it also meant the first load after every
deploy served the *previous* build: the new worker only finished installing
after the old page had already rendered. A shop could be told a fix was live and
still be looking at yesterday's app.

Underneath that was a second, larger problem: **Firebase Hosting serves HTML
with `max-age=3600` by default**, so the browser answered from its own cache
before the service worker ever saw the network — a plain browser with no service
worker at all would have been up to an hour stale too.

Both are fixed:

- Navigations are **network-first with a 2.5s deadline**, falling back to the
  cached shell. Only the HTML takes this path; the content-hashed chunks stay
  cache-first, so boot is still fast.
- That fetch uses `cache: "reload"` to skip the browser's own HTTP cache.
- `firebase.json` serves everything `no-cache` (revalidate against the ETag —
  the usual response is a cheap 304), with `/_next/static/**` overridden to
  `immutable` for a year, since those filenames carry a content hash.

The header rule has to be a catch-all `**`: Hosting matches the **request**
path, not the file it serves, so a rule on `*.html` never matches `/` or a clean
URL like `/profit`.

Verified in headless Chrome against a simulated deploy: the **first** reload
now shows the new build, and an offline reload still boots.


## Admin pages were failing open

Every admin screen guarded itself with `if (profile && profile.role !== "admin")`.
`profile` is `null` on every cold load until the users doc arrives, so the guard
was **skipped** and the page rendered its contents first — cost prices on
`/profit`, staff emails on `/users`, device details on `/devices` — before
flipping to the refusal. `adminOnly` in the nav only hides the link; typing the
URL still got there.

`useAdminGate` (`src/components/AdminGate.tsx`) replaces all five. It denies by
default (`profile?.role !== "admin"`) and shows the splash while auth is still
resolving, so nothing renders before the role is known.

Enforcement is still client-side, like `DeviceGate` — Firestore rules are what
actually stop a determined reader. This stops people.


## Redesign for a small tablet

Three hundred products on a tablet screen changed what the layout has to do.

**The basket is a sheet now, not a permanent drawer.** The old bottom panel was
pinned open at up to 45vh — roughly half a tablet screen, and exactly the half
the product grid needs. In its place is a floating **basket button** carrying
the item count and the running total, so hiding the basket doesn't hide what is
in it. Tapping it opens the full bill, customer, Paid field and Charge/Credit.

**The grid got denser and gained a list mode.** Tiles are smaller and the grid
now runs 3 columns on a phone up to 6 on a wide screen, inside a wider
container. The toggle beside the category chips switches to a compact list —
photos help pick a bun by sight, a list fits far more of a 300-item catalogue on
screen. Both are useful, so the cashier chooses.

**A refusal has to appear where the decision is made.** Blocking a short walk-in
payment used to raise the bottom toast — which the new basket sheet sits on top
of, so the cashier would never have seen it. Charge refusals now render inline
in the basket, above the buttons, and clear as soon as the amount or the
customer changes. The toast itself was raised above the sheet and moves up out
of the basket button's way.

## Bills: the price of a single item

The receipt panel used to show only name, quantity and line total, so there was
no way to check what one item was actually charged at. It is now a proper table
— **Item · Price each · Qty · Amount** — and a line whose price was overridden
carries `normally Rs 120 · Rs 20 off each` underneath, since `listPrice` is
written only when a discount was given. Printed receipts and reprints changed
to match: `Bun  3 x 100.00  Rs 300.00`.

The receipt also **comes up as a sheet on a tablet** instead of stacking under
the bill list, where reading the bill you just tapped meant scrolling past every
other one. Wide screens keep the side-by-side panel. Both render the same
`BillDetail`, so the two can't drift apart.
