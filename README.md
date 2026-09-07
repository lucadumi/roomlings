# Roomlings

A game-like shared kitchen for shopping lists, groceries, monthly bills and fair repayments. **Roomlings records payments; it never moves money.**

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run preview:local
```

Open http://localhost:5173 (API: port 4311). New visitors see the landing page. Choose **Get started** to sign in and create a household, or **Explore the kitchen** to try a private sample. Existing account and browser sessions return to their saved kitchen.

`preview:local` keeps the API process stable while retaining frontend hot reload, so dependency-watcher restarts do not interrupt sign-in requests. Restart it after changing server code, shared schemas or `.env`. Use `npm run dev` while actively developing the API if automatic backend restarts are wanted.

## The landing and kitchen entry

The landing introduces shopping, bills and repayments before sign-in. Its contained **A little look inside** tour uses less than one extra viewport of native scrolling, rather than a five-screen presentation. Reduced motion and short viewports use a normal-flow card with object buttons instead of a scroll runway. The real kitchen model is shared with the app; off-screen rendering pauses and an illustration remains available if WebGL fails.

`/` checks existing account/browser access without automatically creating a sample for new visitors. `/welcome` always shows the public page and never calls the API or changes kitchen storage, making http://localhost:5173/welcome useful for review even while signed in. `/kitchen` explicitly opens the app, reusing existing access or creating a private sample for a new visitor. Existing invitation and recovery links, including `coldshare.*` browser storage, retain their behavior.

**Get started** opens the existing verified-email flow with kitchen creation selected. **Sign in** opens account access. Signing out returns to the landing. API and delivery failures remain visible with retry actions; the landing does not invent a successful login or replace an unavailable saved kitchen with a new one.

The responsive tour measures its actual scene area and content height. Preserve coverage for longer copy, orientation changes, keyboard use, constrained headers and failed WebGL. Scroll restoration is scoped to the current browser history entry, not persistent kitchen storage.

Browser coverage can target an already-running isolated test server with `PLAYWRIGHT_BASE_URL`. Such servers are temporary; use http://localhost:5173 for review and preserve its data and sessions.

Landing references: [Splitwise](https://www.splitwise.com) for straightforward product explanation and [Partiful](https://partiful.com) for playful product presentation. Roomlings retains its own cream, sage and tomato palette, local fonts, copy and kitchen artwork. There are no third-party assets, fabricated testimonials or scroll-hijacking libraries.

## Use

- **Shopping bag:** add and claim items, fill your basket, then record one paid grocery run. Items archive only after saving; ticking them creates no debt.
- **Receipt book:** browse groceries or create, edit and pause monthly bills in **Bills**. Confirm the actual amount and payer to record one expense per bill/month.
- **House pot and fridge:** grocery-only spending and purchases. Bills share the same balances and repayments, not the grocery budget.
- **Envelope:** record or undo roommate repayments. Export the complete ledger from the receipt book.
- **The roommates:** open **Account and membership** for verified-email sign-in, kitchens, invitations and account sessions. Existing browser sessions and recovery codes remain available during migration. Use **Recover existing access** or `/#recover` for older browser-only identities.
- **Room style:** choose Original, Sage, Clay or Linen beside Help and House rules, then apply the look for everyone.

Bill dates use the first creator's time zone. Edits preserve earlier months and recorded payments. Pauses stop future months; resuming never backfills skipped months. Short months use their last day.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run preview:local` | Stable local API and live frontend for review |
| `npm run dev` | Development with automatic API and frontend reloads |
| `npm test` | Domain, API and persistence tests |
| `npm run test:browser` | Browser flows; install Chromium with `npx playwright install chromium` if missing |
| `npm run build` | Type-check and build |
| `npm start` | Serve the production build and API |

## Data and sharing

- Back up `data/kitchen.sqlite`. `.env.example` documents `PORT`, `HOST` and `DATA_DIR`; the development proxy in `vite.config.ts` targets port 4311.
- Keep invitations, session tokens and recovery codes private. All active roommates can edit the ledger. Browser recovery codes work until replaced or their membership access is removed. Legacy `coldshare.*` keys remain supported.
- For other devices, build and run behind HTTPS and access controls. Never expose the development server.

## Accounts and household membership

Accounts use **Supabase Auth email codes**. Supabase manages the verified sign-in identity; application data can use SQLite or a dedicated Postgres schema. Roomlings creates its own expiring, server-validated account sessions in `HttpOnly` cookies. Provider tokens, email codes and account session credentials are never saved in browser storage.

Account setup is opt-in during local development. Without provider configuration, `npm run dev` keeps its existing private sample kitchens, browser access and recovery flows, and the account dialog explains that email sign-in is unavailable. Partial provider configuration fails explicitly. `npm start` refuses to run without complete Supabase configuration and an HTTPS application origin, rather than silently exposing browser-only account creation.

### Configure real email sign-in

1. Create a Supabase project and enable the Email authentication provider, with email confirmation enabled.
2. Configure custom SMTP in **Authentication > Emails > SMTP Settings** first. The hosted project can require SMTP before allowing template edits. Use real credentials from your email provider; the SMTP password is not a Supabase project key. Supabase's default mail service has recipient and rate restrictions. Do not disable email confirmation to work around delivery failures.
3. In **Authentication > Emails > Templates**, update both **Confirm signup** and **Magic Link (or OTP)**. For each, set the subject to **Your Roomlings sign-in code** and replace the complete HTML body with `emails\auth-code.html`. First-time users can receive the signup template; changing only Magic Link leaves them with a broken confirmation-link flow. The shared template uses `{{ .Token }}` and no links. Set a short OTP expiry appropriate for sign-in.
4. Copy the account configuration from `.env.example` into your local, ignored `.env`. The project URL, publishable key and server-only administrative credential belong on the Express server, never in `VITE_*` variables. The administrative credential is used to complete provider-side account deletion.
5. Set the application's allowed origin to the actual review or production URL. Use `http://localhost:5173` for local review and an HTTPS origin in production. Configure the reverse proxy deliberately; do not trust arbitrary forwarded client-IP headers.
6. Restart the server, open **The roommates > Account and membership**, and request a code. The application reports delivery or verification failures rather than claiming a successful sign-in.

Provider setup references: [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

### Roomlings email content and sender

The reusable `emails\auth-code.html` template uses the existing Roomlings colors and wordmark, inline email-safe styling and system fonts. It has no external images, tracking requests, sign-in links or embedded scripts. Paste its HTML into both hosted Supabase templates above; creating the local file does not update the hosted project. The application's project keys cannot edit hosted email templates, so make these changes in the Supabase dashboard.

Template changes affect new emails only. After saving both templates, return to the Roomlings sign-in dialog and request a new code. Do not reuse a confirmation link from an older message. Enter the newest code in the app.

The HTML template does not configure the sender or unlock hosted template editing. For public mail, use a domain you control, verify it with an SMTP provider, and configure **Authentication > Emails > SMTP Settings** in Supabase. Set the sender name to **Roomlings** and use an address on that verified domain. For private testing without a domain, Resend's `onboarding@resend.dev` sender is restricted to the email address associated with your Resend account; it is not suitable for roommate invitations or public signups. SMTP passwords belong in Supabase's SMTP settings, not in browser code or this repository.

### Keep an existing kitchen

Signing in does not automatically claim a similarly named roommate. In **Account and membership > Link existing kitchen access**, explicitly choose a saved browser identity or enter its private recovery code. This links the existing member ID without creating a duplicate person or rewriting expenses, monthly bills, shopping history or balances. Other existing browser sessions keep working until explicitly revoked.

The original kitchen creator is its owner; being the first roommate to link an account does not take ownership from the creator. One account can belong to several kitchens, but cannot claim two different roommates in the same kitchen.

For an account-managed kitchen, open **Membership** to create an expiring invitation. The dialog generates seven-day links, reveals each secret only when created, and lets the owner revoke it. Recipients must sign in before accepting. Reopening an accepted invitation never creates another roommate. Old browser-only invitation codes cannot bypass the managed invitation flow.

### Roles, sessions and leaving

Owners manage invitations, remove access and transfer ownership to another account-linked roommate. Every active member can still edit the shared ledger. Owners must transfer ownership before leaving a kitchen that has other active roommates.

Account settings support display-name changes, browser labels, session revocation and signing out the current device or all devices. Sessions expire after 30 days, or seven days without use. Signing out all devices also revokes linked legacy browser sessions. Recovery codes remain credentials until replaced or the corresponding household access is removed.

Leaving or removal immediately ends that roommate's access, including legacy browser sessions and recovery codes, and releases their shopping claims. Their historical financial references stay, so balances remain consistent. New grocery splits and new bill defaults exclude former roommates. Existing bill schedules are not silently rewritten: review future participants with your roommates before leaving.

New expense and bill-payment records require active participants, including new records for older months. Record outstanding shared purchases and bill payments before removing access; historical repayments can still settle existing balances. A kitchen supports 12 active roommates and up to 200 retained identities. A returning account uses its original member ID, but needs a fresh invitation created after removal.

Account deletion requires explicit email confirmation, sign-in within the previous ten minutes, and ownership handoff where applicable. It removes the account's sign-in identity and access while retaining former-roommate references in shared financial history. It does not cancel debts or erase names someone typed into expense descriptions or shopping notes. Export needed ledgers before deletion. A sole remaining owner can leave and close a kitchen without deleting its historical ledger.

If the provider cannot finish deletion, access is disabled immediately and the deletion stays pending, not successful. The server retries pending deletions at startup and every minute. Keep the server's administrative Supabase credential available until pending deletions have completed.

Before public deployment, configure HTTPS, mail delivery and abuse limits, backups and a clear privacy/retention policy for both Roomlings and its authentication provider.

## Postgres storage and migration

SQLite remains the default. Select Postgres explicitly with `DATABASE_DRIVER=postgres`, a server-only `DATABASE_URL`, and `DATABASE_SCHEMA=roomlings`. A missing or invalid Postgres configuration fails instead of silently falling back to SQLite.

For a persistent backend on an IPv4 network, use Supabase's **Connect > Session pooler** URI. Download the database CA certificate from **Database > Settings > SSL Configuration** and set `DATABASE_SSL_ROOT_CERT` to its path. Certificate and hostname verification stay enabled. `DATABASE_TLS=disable` is accepted only for explicit loopback development/test databases.

The application tables live in the **roomlings** schema; select that schema in Supabase's Table Editor. Supabase's managed **auth** schema is not changed. Household JSON is retained as canonical text so IDs, integer-cent amounts, versions and historical records migrate without reformatting. RLS is enabled and browser roles have no application-schema privileges. The Express server remains the authorization boundary.

Both engines use the same storage and account rules. SQLite operations are serialized on its connection. Postgres transactions pin one pool connection and use a schema-wide advisory lock to preserve the existing cross-household account/deletion invariants and prevent lost updates. This deliberately favors correctness over high write concurrency.

### Safe cutover

1. Put the target `DATABASE_URL`, `DATABASE_SCHEMA` and `DATABASE_SSL_ROOT_CERT` in an ignored `.env.migration` file. Never put database credentials in browser code or Git.
2. Run a dry run with a new backup filename:

   ```sh
   npm run database:migrate -- --source "C:\path\to\kitchen.sqlite" --backup "C:\path\to\backups\preflight.sqlite"
   ```

3. Stop all SQLite writers before the final migration. Run again with a different backup filename and explicit target confirmation:

   ```sh
   npm run database:migrate -- --source "C:\path\to\kitchen.sqlite" --backup "C:\path\to\backups\before-postgres.sqlite" --apply --confirm-schema roomlings
   ```

4. Only after success, configure `.env` with the same Postgres settings and `DATABASE_DRIVER=postgres`, retaining the existing Supabase Auth settings, and restart the preview or production server.

The command creates a consistent SQLite backup including committed WAL data, validates household balances and references, refuses a populated target, copies all application tables transactionally and compares every imported row before committing. It never deletes the original SQLite database. Startup requires the supported schema version; it does not apply migrations automatically.

For immediate rollback before any Postgres writes, stop the server and select SQLite with the original `DATA_DIR`. Once Postgres has accepted new data or account lifecycle changes, do not switch to an older SQLite copy: first reconcile/export the current state or explicitly choose a point-in-time recovery.

Postgres coverage requires an explicit `TEST_DATABASE_URL` and uses unique `roomlings_test_*` schemas that are removed afterward. It never falls back to `DATABASE_URL`. CI runs a separate PostgreSQL service and requires its storage and account-flow job to pass.

## Contributing

See [AGENTS.md](AGENTS.md) for design, testing and approval rules. Publication and merging require separate approval.

Interaction references: [Apple ornaments](https://developer.apple.com/design/human-interface-guidelines/ornaments), [Tiny Room Planner](https://github.com/crayonzgrim/3d-room-planner).
