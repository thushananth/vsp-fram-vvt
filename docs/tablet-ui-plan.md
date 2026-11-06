# Tablet UI plan

The design pattern for every screen in the till, new or redesigned. It was agreed with the owner on
2026-11-07 from the sample page:
https://claude.ai/artifact/Pks8bsdxYeP6qrmV6u2UvX (private; ask the owner for access).

**Goal:** the same colours as today, fewer boxes, clearer buttons, built for a tablet held upright.

## What was wrong with the old look

- Almost every block was a white box with a 1px `#e4e9f1` border on a `#f6f8fb` ground. That border is
  barely visible, so the screen read as faint outlines and nothing stood out.
- Radii were mixed (`rounded-xl`, `2xl`, `3xl`) with no rule.
- One blue did every job: chips, links, Change, Re-send and Charge all looked equally important.

## Rules

1. **Keep the existing colours.** Use the tokens in `src/app/globals.css`. Don't add new hex values in
   components. Add only these new tokens:

   ```css
   /* :root */
   --color-field: #edf1f7;        /* input and track fill */
   --color-accent-soft: #e8effe;  /* secondary button, selected row */
   --color-success-soft: #e7f6ec; /* Paid, Change */
   --color-warning-soft: #fdeee4; /* Credit, owes, Still owing */
   --color-danger-soft: #fdeaea;  /* Held, field error */

   /* @theme inline */
   --color-field: var(--color-field);
   --color-accent-soft: var(--color-accent-soft);
   --color-success-soft: var(--color-success-soft);
   --color-warning-soft: var(--color-warning-soft);
   --color-danger-soft: var(--color-danger-soft);
   ```

2. **Use fills, not borders.** Inputs, search boxes and tracks sit on `bg-field` with no border. Lists use
   thin dividers (`border-b border-field`), not a box per row. Panels are `bg-surface` on `bg-ground`
   with no border; use at most a very soft shadow.
3. **Use only three radii:** `rounded-xl` (12px) for fields and buttons, `rounded-2xl` (16px) for panels
   and tiles, and `rounded-t-[22px]` for sheets that slide up from the bottom. Chips are `rounded-full`.
4. **Give every colour one job.** Blue means "do this". Green means paid or change. Orange means owing or
   credit. Red means remove or failed. Status colours are separate from the accent.
5. **Touch first.** Nothing tappable under 44px. Normal buttons and fields are 48–52px. The main action
   (Charge) is 64px.
6. **Make numbers big and aligned.** Totals are 24px or more, `font-extrabold`. Every amount uses
   `tabular-nums` and `money()`.
7. **Design for an 800 × 1280 portrait tablet first**, then check phone and desktop.

## Components

### Inputs

```
min-h-[52px] rounded-xl bg-field px-4 text-base font-semibold outline-none
placeholder:text-muted-2 placeholder:font-medium
focus:bg-surface focus:ring-2 focus:ring-accent          (focused: turns white, blue ring)
error: bg-danger-soft ring-2 ring-danger + a message under it that says how to fix it
disabled: opacity-50
```

- Search fields put a muted icon on the left and a small "SCAN" hint on the right.
- Money fields (Paid) are 64px tall with a 28–30px `font-extrabold` value. They open the on-screen
  `NumPad`, never the system keyboard.
- Labels go above the field: `text-[13px] font-bold`.

### Buttons, from loudest to quietest

| Kind | Use | Classes |
|---|---|---|
| Charge | The one main action on Billing | `min-h-[64px] rounded-[14px] bg-accent text-white text-[19px] font-extrabold` |
| Primary | Save, Confirm | `min-h-12 rounded-xl bg-accent text-white font-bold` (hover/pressed `bg-accent-hover`) |
| Soft | The other choice (Credit, Put on credit) | `bg-accent-soft text-accent-hover` |
| Tonal | Tools (Export CSV, Reprint, SMS) | `bg-field text-ink`, hover `bg-border` |
| Ghost | Small moves (Change, JSON) | `text-accent px-3`, hover `bg-accent-soft` |
| Danger | Delete bill | `bg-danger text-white` |
| Danger ghost | Remove line, Clear | `text-danger`, hover `bg-danger-soft` |

- Use only **one solid button per screen region**.
- Pressed state is `active:scale-[0.98]`. Disabled is `opacity-40`. Focus is a 3px accent outline.
- Small buttons (`min-h-10 px-3.5 text-[13.5px] rounded-[10px]`) are for headers and toolbars only.

### Segmented control (payment status: kept as it was)

A grey track `rounded-xl bg-field p-1` holding buttons `min-h-11 rounded-[9px] px-4 font-bold
text-muted`. The selected one is `bg-surface text-ink shadow-sm`. Use it for Paid / Credit / Queued,
date ranges (Today / Yesterday / This week / This month / Dates), and grid/list toggles.

### Item-type (category) filter

Same track as the segmented control, so the two read as one family:

- The track is `flex gap-1 rounded-[14px] bg-field p-[5px] overflow-x-auto` and scrolls sideways with
  no visible scrollbar.
- Each type is `min-h-[50px] rounded-[10px] px-3.5`. It shows a 14px rounded square in the category's
  colour, then the name, then a count pill (`text-xs font-extrabold`).
- The selected type is `bg-surface text-ink shadow-sm`, and its count pill takes the category's soft colour.
- "All" comes first. Its square is a small mix of the category colours.

### Badges

`h-6 rounded-[7px] px-2.5 text-xs font-extrabold`:

- Paid: `bg-success-soft text-[#15803d]`
- Credit: `bg-warning-soft text-[#c2410c]`
- Queued: `bg-field text-muted`
- Held: `bg-danger-soft text-danger`
- owes Rs …: warning
- advance Rs …: success

### Switches

46 × 28 track, `bg-accent` when on, with the label on the right. Use them for Print receipt and Send SMS.

### Keypad

Keys are 50px tall, `rounded-xl bg-surface text-[22px] font-bold`, on a `bg-ground` panel. On Billing
it is a 4-column grid: 7 8 9 Exact / 4 5 6 5,000 / 1 2 3 10,000 / 00 0 ⌫ 20,000. Quick-cash keys use
`bg-accent-soft text-accent-hover`.

## Page layouts (portrait 800 × 1280)

### Billing (`src/app/page.tsx`)

1. Dark app bar (64px), as today.
2. A top row with a "Bill for" customer chip (avatar, name, owes/advance badge, "Change" link) and a
   search field that takes the rest of the width.
3. The item-type filter.
4. Product grid, 4 columns. Each tile is `bg-surface rounded-2xl p-3 min-h-[120px]` with a
   category-tinted code square, the name, and the price per unit at the bottom. A product already in the
   bill gets a 2px accent inset ring and an "In bill" tag.
5. **Basket docked at the bottom**, about 620px tall, always open, with `rounded-t-[22px]` and an upward
   shadow. Two columns:
   - Left: the lines (name; `qty × price`, with a below-list price in orange and the list price
     struck through; amount on the right), then To pay (28px), then Print and SMS switches.
   - Right: the Paid field, the Change / Still owing box (green or orange), the keypad, then Credit
     (soft, 1/3) and Charge (2/3).

### View bills (`src/app/bills/page.tsx`)

1. App bar, then a header ("Today" plus the date) with Export CSV (tonal) and JSON (ghost).
2. Date-range segmented control.
3. **One stats band**: a single `bg-surface rounded-2xl` with 4 cells separated by thin dividers
   (Bills, Sales, Cash in, Queued), each with a small note in its status colour. No separate stat boxes.
4. Held-bills strip: `bg-danger-soft rounded-[14px]` with a solid danger "Re-send" button.
5. Search field and the Paid / Credit / Queued segmented control on one row.
6. A full-width bill list in one panel. Each row shows the number, customer, time and item count,
   then the amount and a status badge. The selected row is `bg-accent-soft`.
7. **The open bill slides up from the bottom** (about 520px). It has a grab handle, a header with
   number, badge and customer, and Reprint / SMS / Delete buttons. Below that is the item table (Item,
   Price each, Qty, Amount) and a summary strip: Total, Paid, then Owing (orange) or Change given (green).

## How to roll it out

- Work on the `tablet-ui-revamp` branch.
- Do **one page per change**, in this order: Billing, Bills, Customers, Credit, Products, Reports,
  then the admin pages.
- **Change only styles and layout.** Don't touch handlers, calculations, Firestore calls or permission
  checks. If a layout change seems to need a logic change, stop and ask.
- Add the five tokens to `globals.css` in the first change.
- Keep the loading rules in `CLAUDE.md` (skeletons, `NavPending`, opacity-only page fade).
- The owner checks each page on the tablet before the next one starts. Deploy only when asked.
