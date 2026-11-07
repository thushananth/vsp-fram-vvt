# AI shop assistant: hand-off brief

Context for building the admin chatbot in VSP Farm POS. CLAUDE.md already covers the stack, data
loading (`useLive`), security rules, advance orders, App Check and deploy rules, so read it first.
Old plan (written for an API key and a Cloud Function, now superseded by this brief):
https://claude.ai/artifact/GzkpGGfb3VKw7ma63qtt6S. Update that artifact before building.

## Current state (7 Nov 2026)

- Branch `feature/advance-orders` (commit 56abdc4) is deployed and not merged to `main`.
- App Check: reCAPTCHA Enterprise, started by `startAppCheck()` in `src/lib/firebase.ts`, called from
  `RootShell` after mount, only on `vsp-farm-web.web.app`. Registered, not enforced anywhere yet.
- The owner has enabled the Gemini API / Firebase AI Logic in the Firebase console and set a billing
  budget of 0 on `vsp-farm-web` (Blaze plan).

## Decisions the owner has made

1. **Use Firebase AI Logic** (`firebase/ai`, Gemini Developer API backend), called from the admin's
   browser. No AI Studio key and no `askShop` Cloud Function.
2. **Admins only.** Hide the nav item and gate the page with `useAdminGate`. Note: AI Logic itself
   can't check roles. What protects data is that every read runs as the signed-in user under the
   Firestore rules.
3. **The AI gets read access to the whole database, not only fixed filters.** Do it the safe way below.
4. **New use case, cash check:** a cashier is short (e.g. Rs 2,500) at day end. The AI reads that
   day's bills and payments and points out which bills could explain it, through the same chat.

## Architecture

- `src/lib/assistant/`: model setup, tool declarations, tool runner, masking. `src/app/ask/page.tsx`:
  the chat screen.
- Model: `getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true })` then
  `getGenerativeModel(ai, { model, tools, systemInstruction })`. Check the exact API in
  `node_modules/firebase/ai` typings and the current model names in the Firebase docs. Don't trust
  memory. Keep the model name in one constant.
- Function calling loop in the browser: send the question → Gemini returns `functionCall`s → run them
  locally → send `functionResponse`s → final text. At most 6 rounds per question.
- System instruction: today's date (Asia/Colombo); money is Rs; use only tool results; never do
  arithmetic yourself, call `aggregate` or a compute tool; say plainly when data can't answer; reply in
  the language of the question (English/Tamil).

## "Full read access", done safely

Instead of free-form queries, give the AI **one generic read-only query tool and one aggregate tool**,
plus compute tools for things it must not work out itself:

- `query({ collection, where[], orderBy?, limit? })`: rows from an allowlisted collection.
- `aggregate({ collection, where[], sum[], count, groupBy? })`: sums and counts worked out in code.
  The LLM must use this for any total.
- Compute tools: `sales_summary` (reuse `buildSalesReport` from `src/lib/salesReport.ts`, so figures
  match the Report screen), `customer_account`, and `cash_check` (below).

Guardrails in the tool runner (these are what make "full read" safe):

- **Read-only by construction:** files in `src/lib/assistant/` may import only `getDocs`, `getDoc`,
  `query`, `where`, `orderBy`, `limit`, `collection`, `doc`, `Timestamp`. Add an ESLint
  `no-restricted-imports` rule for that folder banning `setDoc`, `updateDoc`, `addDoc`, `deleteDoc`,
  `writeBatch`, `runTransaction`, `httpsCallable` and every `@/lib/firestore/*` write helper. No tool
  sends SMS, prints or writes. A suggestion chip may open an existing screen (e.g. the reminder sheet),
  and a person taps Send there.
- **Allowlisted collections and fields:** `bills`, `customers`, `creditPayments`, `orders`, `products`,
  `categories`, `users` (name and role only), `settings/store`. Never `deviceApprovals`,
  `deviceCodes`, `orderTracking`, `orderDigests`, `smsCampaigns`, `orders/*/log`. Strip
  `mobileNumber`, `email`, `trackToken`, device fields. Decide with the owner about `costPrice`
  (profit).
- **Masking:** customer and cashier names go to Gemini as codes (`C7`, `U2`); the screen swaps them
  back. The code table lives only in that chat. Product and category names are sent as they are.
- **Bounded reads:** `bills` / `creditPayments` queries must have a `createdAt` range ≤ 62 days.
  `orders` must have a `deliveryDate` range. Max 300 rows returned per call (more → use `aggregate`).
  Max ~3,000 document reads per question. Validate every field name and operator against the
  allowlist. Refuse anything else with a message Gemini can act on.
- **Rules:** no rule changes needed. Reads run as the admin, and no new collections are needed unless
  a usage log is added (functions-only write, admin read).

## Cash check (shortage finder)

`cash_check({ date, cashier?, shortBy })` worked out in code:

- **Expected cash** = Σ `paid` of that day's non-void bills by the cashier + Σ cash `creditPayments`
  (`method: "cash"`, `receivedBy` = cashier) that day. Ask the owner about the opening float, refunds
  of voided bills (`voidBill` keeps `paid`) and whether cash is counted per cashier or per till.
- **Candidates**, each with a reason, ranked:
  - single bills whose `paid` or `total` is within ±Rs 20 of `shortBy`
  - pairs (and small triples) of cash bills that add up to it
  - bills where `tender - paid ≠ change`, or with unusually large change
  - bills with a price override (`listPrice` present) or round-off `discount`
  - bills voided that day after cash was taken
  - credit bills part-paid at the till
  - duplicate-looking bills (same total and lines within a few minutes)
  - bills still queued or held (see `billJournal`)
- The chat shows the candidates as bill cards (`billLabel()` numbers, time, amount, reason) linking
  to Bills. The AI explains; it never accuses. Word it as "bills to check".

## Screen (`/ask`, admin nav item "Ask")

Patterns from https://www.beautifului.dev/ (Tool Chips, Streaming Text with source chips, Records
Table, suggestion chips, pill Prompt Bar, shimmer loading). Tablet portrait first (800 × 1280), 44px+
targets, skeletons not "Loading…", the app's colour tokens, `tabular-nums`. Figures in cards come from
tool results, not from the model's text. Starter chips: Today's sales · This week vs last week · Who
owes the most · Tomorrow's orders · Cash check for today · Top products this month. The chat isn't
saved and clears on leaving. If offline, say "Ask needs the internet".

## Console / cost (tell the owner)

- **Enforce App Check for Firebase AI Logic** now (safe: nothing else uses it). Use limited-use
  tokens (above).
- Set the **per-user rate limit** in AI Logic settings (e.g. 10/min).
- **A Rs 0 budget does not stop spending.** Google Cloud budgets only send alerts. To actually cap
  usage, lower the Gemini API quota (Cloud console → APIs → Generative Language API → Quotas →
  requests per day) to e.g. 200/day. Check whether `vsp-farm-web` gets the free or the paid tier in
  AI Studio. On the free tier Google may review prompts, which is a reason for the masking.
- App Check only works on `vsp-farm-web.web.app`, so test the chat on the deployed site or add a
  debug token for localhost (`self.FIREBASE_APPCHECK_DEBUG_TOKEN`, registered in the console). Never
  ship the debug provider.

## Build order

1. Update the plan artifact to this design. Ask the owner the open questions: cash float and refunds,
   `costPrice`/profit, daily cap.
2. `src/lib/assistant/`: allowlist, validators, masking, `query`, `aggregate`, compute tools,
   `cash_check`, the ESLint read-only rule. Unit tests with sample bills (totals must equal
   `buildSalesReport`; `cash_check` finds a planted Rs 2,500 bill and a pair).
3. Model + function-calling loop, with a fake model in tests so the quota isn't used.
4. `/ask` screen and nav item (admin only; add to the AppShell prefetch list).
5. `npx tsc --noEmit`, lint, `npm run build`, `npm run test:rules`. Commit only when asked. Deploy only
   when the owner says "deploy".
