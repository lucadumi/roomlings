# Storage and deployment

Run commands from the repository root. Keep database files, credentials, recovery codes and backups out of Git.

## Local storage

SQLite is the default, at `data/kitchen.sqlite`. Back it up before operational changes. [.env.example](../.env.example) documents `DATA_DIR`, `HOST` and `PORT`; the Vite proxy expects the API on port 4311.

SQLite startup adds account-recovery, room-permission and notification tables transactionally while retaining existing account, browser-session and kitchen data. It records existing legitimate kitchens' original creator IDs without rewriting household JSON or granting delegated rights. Postgres requires the explicit upgrade below.

Use `npm run preview:local` for a stable API with frontend hot reload. Restart it after server, schema or environment changes. `npm run dev` also watches the API.

## Postgres

Set `DATABASE_DRIVER=postgres`, a server-only `DATABASE_URL`, and `DATABASE_SCHEMA=roomlings`. Invalid configuration fails rather than silently falling back to SQLite.

For Supabase over IPv4, use the **Connect > Session pooler** URI. Download the CA certificate from **Database > Settings > SSL Configuration** and set `DATABASE_SSL_ROOT_CERT` to its path. Certificate and hostname verification remain enabled. `DATABASE_TLS=disable` is only for explicit loopback development/test databases.

Application tables live in the `roomlings` schema, not Supabase's managed `auth` schema. RLS is enabled and browser roles have no application-schema privileges; Express enforces authorization.

Household JSON remains canonical text, preserving IDs, integer cents, versions and historical references. Both engines share storage rules. SQLite serializes its connection; Postgres transactions pin a connection and use a schema-wide advisory lock to prevent lost updates and preserve account/deletion invariants.

Connection failures surface as unconfirmed requests, and broken checked-out clients are discarded without an unhandled connection error taking down the API. A lost commit response still requires the existing mutation-retry confirmation; the application does not assume that a disconnected request was never saved.

Room authority is private persistence, not client-editable household JSON. `household_room_owners` retains each legitimate kitchen's original creator ID for browser-only ownership. A row in `household_accounts` makes its current `owner_member_id` authoritative instead, including `NULL` for a closed kitchen. `household_room_admins` stores explicit `(household_id, member_id)` delegations. Role resolution checks current active membership; it never uses display names. Household saves retain creator metadata and remove delegations for inactive or removed identities. Leaving, removal, deletion, rejoining and ownership transfer also clear the relevant delegation rows transactionally.

Rows carrying the retired example marker are preserved byte for byte during migration and remain in place, but the application refuses access, recovery, invitations, account membership joins and saves for them. This prevents legacy examples from being reclassified as real kitchens when the current public household schema ignores their old marker. Older legitimate rows with the original false marker remain readable.

## Postgres schema upgrades

Application schema version 5 adds `analytics_events`, including its dedup, expiry and reporting indexes. Application schema version 4 adds `notification_preferences`, `push_devices`, `notification_events` and `notification_deliveries`, including uniqueness, claim and retention indexes. Versions 1, 2, 3 and 4 can upgrade directly to version 5. Version 1 also receives version 2's recovery tables; versions 1 and 2 receive version 3's `household_room_owners` and `household_room_admins`; versions 1, 2 and 3 receive version 4's notification tables. Version 4 upgrades leave all existing tables and rows untouched.

The upgrade is additive: it does not rewrite existing rows, rotate sessions, change account/member IDs or recalculate the ledger. It records the original creator ID from each legitimate existing household, skips retired examples, and leaves current account-managed ownership untouched. It neither grants delegated admin rights nor generates recovery codes.

Startup only checks the supported version. It never applies Postgres DDL or falls back to SQLite when a schema is old, absent or unsupported.

1. Confirm which applications use the target database and schema, and obtain approval before changing a shared database. A local worktree or `localhost` preview can still use shared Postgres; another branch is not database isolation. Coordinate a maintenance window and compatible application builds for every process using that schema.
2. Stop application writers and take a consistent Postgres backup or provider snapshot, including the application schema, `schema_migrations`, data and privileges. Verify the restoration procedure and keep the backup outside Git. The upgrade command does not create a Postgres backup; `--source` and `--backup` are SQLite-import flags and are rejected with `--upgrade`.
3. Put the intended target settings in the ignored `.env.migration` file, as for SQLite migration. Use the same trusted server-side database role that owns and operates the application schema and tables, so the running API also owns the new private tables. Inspect the read-only plan:

   ```sh
   npm run database:migrate -- --upgrade
   ```

   The JSON result contains `schema`, `fromVersion`, `toVersion` and `applied`. A pending upgrade reports `fromVersion: 1`, `2`, `3` or `4`, `toVersion: 5`, and `applied: false`. Dry runs inspect metadata under the shared advisory lock without writing tables, privileges, owner rows or migration records. Supplying confirmation without `--apply` is still a dry run.

4. Only after reviewing the target and backup, explicitly apply to the exact configured schema name:

   ```sh
   npm run database:migrate -- --upgrade --apply --confirm-schema roomlings
   ```

   Both flags are required to mutate. Missing or mismatched confirmation, absent/unversioned schemas, unsupported versions and conflicting newly introduced objects fail without upgrading. Required DDL, any original-creator backfill, RLS, schema/table/default-privilege protections and the version 5 record commit together under the application transaction and advisory lock. Unsafe or invalid creator data aborts older-schema upgrades. A failure rolls the whole upgrade back. Browser roles retain no application-schema or private-table access, including encrypted registrations, outbox and retention-analytics data.

5. After success, restart the API and any push workers with the schema-version-5-compatible build and matching Postgres settings. `preview:local` does not watch API files, so its API needs an explicit coordinated restart. Verify existing sign-ins, household membership, room roles and ledger data without clearing browser storage or replacing session tokens. Repeating either upgrade command on version 5 safely returns `applied: false` with both versions set to `5`; it does not change roles, replace codes or append a migration record.

**Compatibility and rollback:** older version-1 to version-4 builds reject a version-5 database when they start or restart, even though the DDL is additive. Do not upgrade a shared preview database while another feature still requires an incompatible build. Reverting the checkout alone is not a rollback, and there is no automatic down migration. Do not drop private tables or edit migration markers to bypass version checks. Prefer a compatible forward fix. Restoring an older backup requires stopping all writers and restoring the complete approved backup with a matching build; after version-5 writes, restoration would lose newer preferences, registrations, notifications, retention analytics, account, ledger and session changes unless reconciled.

## SQLite migration

1. Put the target `DATABASE_URL`, `DATABASE_SCHEMA` and `DATABASE_SSL_ROOT_CERT` in an ignored `.env.migration` file.
2. Dry-run with a new backup filename:

   ```sh
   npm run database:migrate -- --source data/kitchen.sqlite --backup preflight.sqlite
   ```

3. Stop all SQLite writers. Apply with a different backup filename and explicit target confirmation:

   ```sh
   npm run database:migrate -- --source data/kitchen.sqlite --backup before-postgres.sqlite --apply --confirm-schema roomlings
   ```

4. Only after success, put the same Postgres settings in `.env`, retain the Supabase Auth configuration, set `DATABASE_DRIVER=postgres` and restart the server.

Migration backs up committed WAL data, validates balances and references, refuses a populated target, copies all application tables transactionally and compares every imported row. Recovery hashes, room roles, notification preferences, encrypted registrations, queue claims and deduplication state are included. Preserve the same protected-token encryption key across cutover. For an older SQLite source, only the backup receives additive table initialization and creator backfill. Migration never deletes or rewrites the original SQLite database. Startup checks the supported schema version; it does not apply Postgres migrations automatically.

**Rollback:** before any Postgres writes, stop the server and select SQLite with the original `DATA_DIR`. After Postgres accepts data or account changes, do not switch to an older SQLite copy without reconciliation or an explicit point-in-time recovery.

Postgres tests require `TEST_DATABASE_URL`; they use disposable `roomlings_test_*` schemas and never fall back to `DATABASE_URL`. CI supplies its own Postgres service. `node --test tests/postgres-upgrade.test.ts` checks upgrade and CLI safety without a database connection. Real upgrade, rollback, privacy, cross-connection claims, recovery and SQLite-import parity coverage lives in `tests/postgres.test.ts` and `tests/notifications-persistence.test.ts`. PostgreSQL-only tests skip without `TEST_DATABASE_URL`; skipped tests are not database validation. CI also runs notification API and worker tests against Postgres.

## Native push setup

Push is optional. Missing, incomplete or invalid push configuration leaves ordinary accounts and ledger operations working, but reports `pushAvailable: false`. Native registration fails explicitly with `503 PUSH_NOT_CONFIGURED`. Preferences and installation deletion remain usable. See the [fixed native API contract](accounts.md#native-notification-preferences-and-registrations).

1. In the Apple Developer account, enable Push Notifications for the `com.roomlings.app` App ID. Obtain an APNs `.p8` signing key, its 10-character Key ID and the 10-character Team ID. Configure `APNS_TEAM_ID` and `APNS_TOPIC=com.roomlings.app`.
2. Use `APNS_SANDBOX_KEY_PATH` plus `APNS_SANDBOX_KEY_ID` for development-signed apps, and `APNS_PRODUCTION_KEY_PATH` plus `APNS_PRODUCTION_KEY_ID` for distribution/TestFlight. Configure at least one pair. Modern Apple keys may be environment- or topic-scoped: each key must authorize the configured environment and topic. Only reuse a legacy dual-environment key if Apple explicitly grants that scope. Registration in an unconfigured environment returns the same explicit 503.
3. Put `.p8` files in a server-only secret mount or ignored `data/` path, readable only by the server account (`0600`). Never commit keys or prefix secrets with `VITE_`.
4. Set `PUSH_TOKEN_ENCRYPTION_KEY` to a separate base64-encoded 32-byte random secret, identical across API and worker instances. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and transfer it directly into the deployment secret manager, not shared logs. Tokens use AES-256-GCM with fresh nonces and authenticated account/session/installation/revision context. Token lookup uses a separately derived keyed HMAC, not plaintext or a public token hash.
5. Apply the approved database upgrade first, then restart compatible processes with the same database, secrets and mode. Never apply an upgrade to a shared review or production database just to test another branch.

The native project must separately enable its Push Notifications capability, provisioning profile and signed `aps-environment` entitlement. This web repository does not configure native signing or embed Apple secrets. Ordinary alert pushes do not require a background-fetch mode.

### Worker operation

`PUSH_WORKER_MODE=inline` is the default: a configured API starts delivery and scheduling automatically. `external` leaves delivery to a separately supervised process:

```sh
npm run push:worker
```

The standalone worker requires valid push configuration and uses the same database settings as the API. Use `external` on API instances when operating separate workers. `disabled` disables registration and inline delivery while preserving preference APIs. Coordinate mode and key changes across all processes. API and worker instances can share one database safely: claims use the existing SQLite transaction boundary or Postgres advisory-lock boundary, then release the database before network delivery. SQLite workers must share the same durable database file on a local filesystem, not independent container copies or network storage.

The worker polls every second, drains up to 20 jobs per cycle, checks daily schedules every 30 seconds and performs retention cleanup every minute. API instances without an inline worker also run retention cleanup. Keep at least one worker continuously running and supervised; `pushAvailable` validates configuration but cannot prove an external worker is alive or Apple is accepting deliveries. The explicit worker command fails instead of silently starting without keys.

Money notifications are enqueued in the same transaction as confirmed new ledger entries. Failed saves roll back both; replayed mutation receipts do not enqueue again. All active other members with eligible registered sessions and money enabled are recipients, not just payers or split participants.

Chore summaries use the existing `billingTimeZone`, assignment/status helpers and stored-object pause rules. The first scheduler pass at or after local 09:00 snapshots each active member once per local date. Restart catch-up is limited to 09:00 through 09:59; summaries expire at 10:00 and never arrive as an evening backlog. The snapshot is consumed even when there are no due chores or eligible devices, so enabling push or adding a chore later does not create another summary. DST and fractional-hour offsets follow the household's IANA zone, not the server clock zone.

Before each send, the worker rechecks active account membership, current session and registration, preference mute, retained ledger entry, or current due date, assignment and object state. A revoked or muted job cannot be revived by retry. An already-submitted APNs request cannot be recalled.

APNs uses Node's HTTP/2 and crypto implementations, TLS 1.2+, ES256 provider tokens cached for 50 minutes, reusable per-environment connections, generic alerts and stable delivery/collapse/grouping IDs. Network requests time out after 10 seconds. A 60-second claim lease allows crashed work to be reclaimed; stale claim results cannot acknowledge new work or delete refreshed registrations.

Delivery is best effort, not exactly once across the APNs/database boundary. Stable IDs coalesce retries, but an interrupted Apple acknowledgement can still require resubmission. Money jobs expire after 24 hours; chore jobs expire at local 10:00. Up to eight attempts use persisted exponential backoff with jitter and bounded `Retry-After` handling. HTTP 429 and 5xx/network failures retry; rejected payload/provider credentials fail with a safe operational category. HTTP 410 or `BadDeviceToken`/`DeviceTokenNotForTopic` invalidate only the exact registration revision sent. A 410 timestamp predating the latest registration never deletes it.

### Retention and incident handling

- Registrations are removed on sign-out, device/session revocation and account-deletion barriers. Expired sessions, seven-day-idle sessions and tokens not re-registered for 30 days are cleaned up. No token is exposed in API responses.
- Preferences are separate member records, retained across reinstall and inactive membership, and deleted with the account membership on account deletion.
- Outbox records contain routing IDs and safe status categories, not chore or money text. Dedup and terminal history expire 30 days after notification expiry. Session/installation deletion immediately cascades associated deliveries.
- Back up the encryption key separately from the database. Do not rotate it independently on one worker. For a planned rotation, stop all push writers/workers, preserve an approved backup, explicitly clear only push registrations and their dependent deliveries, then deploy the new key consistently. Clients re-register on opted-in launch; preference records remain. Existing ciphertext cannot be decrypted with a replacement key.
- Monitor the supervised process and generic configuration, retention, provider-auth and protected-token failures. Never enable `NODE_DEBUG=http2`, header/body tracing or token-containing URL logging. Do not log `.p8` contents, provider JWTs, tokens, ciphertext or raw Apple errors. No push analytics are collected.

### Real-device acceptance

Automated tests use injected providers and a loopback HTTP/2 fake, never real APNs. Before claiming delivery, obtain owner-approved Apple keys and signing, a reachable HTTPS account API, matching environment/topic provisioning, physical iPhone/iPad builds and explicit client opt-in/OS notification permission.

Verify locked-screen generic text, both categories, local 09:00 delivery, multiple devices, another member's expense/checkout/repayment, actor exclusion, mute/re-enable, logout/revocation, account switching, reinstall, stale/deleted-entry taps and background/terminated launch. TestFlight uses production APNs. Lack of keys or a signed physical device remains an actual acceptance blocker, not a passing simulator test.

Apple references verified for this implementation: [token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns), [HTTP/2 notification requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), and [APNs responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns).

## Deployment

Build with `npm run build`, then serve the build and API with `npm start`. Configure [Supabase accounts](accounts.md), HTTPS, the correct `APP_ORIGIN`, mail delivery, abuse limits, backups and a privacy/retention policy first.

Keep API writers sharing a database on compatible builds, even when no SQL schema upgrade is needed. Household mutation-retry receipts and private account-creation receipts live inside household JSON; an older server can pass the SQL schema check but discard that metadata on its next save. Coordinate deployment and restarts for every writer rather than relying on the schema version alone.

Keep the development server private. Do not expose credentials in frontend environment variables, logs or source control.
