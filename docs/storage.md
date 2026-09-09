# Storage and deployment

Run commands from the repository root. Keep database files, credentials, recovery codes and backups out of Git.

## Local storage

SQLite is the default, at `data/kitchen.sqlite`. Back it up before operational changes. [.env.example](../.env.example) documents `DATA_DIR`, `HOST` and `PORT`; the Vite proxy expects the API on port 4311.

SQLite startup adds the account-recovery and room-permission tables transactionally while retaining existing account, browser-session and kitchen data. It records existing legitimate kitchens' original creator IDs without rewriting household JSON or granting delegated rights. Postgres requires the explicit upgrade below.

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

Application schema version 3 adds `household_room_owners` and `household_room_admins` with their primary-key indexes. Both version 1 and version 2 schemas can upgrade directly to version 3. Version 1 upgrades also add version 2's `account_recovery_settings`, `account_recovery_codes` and their indexes. Version 2 upgrades leave recovery tables and hashes untouched.

The upgrade is additive: it does not rewrite existing rows, rotate sessions, change account/member IDs or recalculate the ledger. It records the original creator ID from each legitimate existing household, skips retired examples, and leaves current account-managed ownership untouched. It neither grants delegated admin rights nor generates recovery codes.

Startup only checks the supported version. It never applies Postgres DDL or falls back to SQLite when a schema is old, absent or unsupported.

1. Confirm which applications use the target database and schema, and obtain approval before changing a shared database. A local worktree or `localhost` preview can still use shared Postgres; another branch is not database isolation. Coordinate a maintenance window and compatible application builds for every process using that schema.
2. Stop application writers and take a consistent Postgres backup or provider snapshot, including the application schema, `schema_migrations`, data and privileges. Verify the restoration procedure and keep the backup outside Git. The upgrade command does not create a Postgres backup; `--source` and `--backup` are SQLite-import flags and are rejected with `--upgrade`.
3. Put the intended target settings in the ignored `.env.migration` file, as for SQLite migration. Use the same trusted server-side database role that owns and operates the application schema and tables, so the running API also owns the new private tables. Inspect the read-only plan:

   ```sh
   npm run database:migrate -- --upgrade
   ```

   The JSON result contains `schema`, `fromVersion`, `toVersion` and `applied`. A pending upgrade reports `fromVersion: 1` or `2`, `toVersion: 3`, and `applied: false`. Dry runs inspect metadata under the shared advisory lock without writing tables, privileges, owner rows or migration records. Supplying confirmation without `--apply` is still a dry run.

4. Only after reviewing the target and backup, explicitly apply to the exact configured schema name:

   ```sh
   npm run database:migrate -- --upgrade --apply --confirm-schema roomlings
   ```

   Both flags are required to mutate. Missing or mismatched confirmation, absent/unversioned schemas, unsupported versions and conflicting newly introduced objects fail without upgrading. The required DDL, original-creator backfill, RLS, schema/table/default-privilege protections and version 3 record commit together under the same transaction and advisory lock used by application operations. Unsafe or invalid creator data aborts the upgrade. A failure rolls the whole upgrade back. Browser roles retain no application-schema, recovery-table or permission-table access.

5. After success, restart the API with the schema-version-3-compatible build and matching Postgres settings. `preview:local` does not watch API files, so its API needs an explicit coordinated restart. Verify existing sign-ins, household membership, room roles and ledger data without clearing browser storage or replacing session tokens. Repeating either upgrade command on version 3 safely returns `applied: false` with both versions set to `3`; it does not change roles, replace codes or append a migration record.

**Compatibility and rollback:** older version-1 and version-2 application builds reject a version-3 database when they start or restart, even though the DDL is additive. Do not upgrade a shared preview database while another feature still requires an incompatible build. Reverting the checkout alone is not a rollback, and there is no automatic down migration. Do not drop recovery or permission tables or edit migration markers to bypass version checks. Prefer a compatible forward fix. Restoring an older backup requires stopping all writers and restoring the complete approved backup with a matching application build; after version-3 writes, restoration would lose newer role, account, ledger and session changes unless they are reconciled.

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

Migration backs up committed WAL data, validates balances and references, refuses a populated target, copies all application tables transactionally and compares every imported row. Account-recovery metadata and unused-code hashes, original creator metadata and delegated admin rows are included, preserving code usability, single-use state and room roles after cutover. For an older SQLite source, only the backup receives additive table initialization and creator backfill. Migration never deletes or rewrites the original SQLite database. Startup checks the supported schema version; it does not apply Postgres migrations automatically.

**Rollback:** before any Postgres writes, stop the server and select SQLite with the original `DATA_DIR`. After Postgres accepts data or account changes, do not switch to an older SQLite copy without reconciliation or an explicit point-in-time recovery.

Postgres tests require `TEST_DATABASE_URL`; they use disposable `roomlings_test_*` schemas and never fall back to `DATABASE_URL`. CI supplies its own Postgres service. `node --test tests/postgres-upgrade.test.ts` checks upgrade and CLI safety without a database connection. Real upgrade, rollback, privacy, cross-connection single-use recovery and SQLite-import parity coverage lives in `tests/postgres.test.ts`; that suite skips without `TEST_DATABASE_URL`, and skipped tests are not database validation.

## Deployment

Build with `npm run build`, then serve the build and API with `npm start`. Configure [Supabase accounts](accounts.md), HTTPS, the correct `APP_ORIGIN`, mail delivery, abuse limits, backups and a privacy/retention policy first.

Keep API writers sharing a database on compatible builds, even when no SQL schema upgrade is needed. Household mutation-retry receipts and private account-creation receipts live inside household JSON; an older server can pass the SQL schema check but discard that metadata on its next save. Coordinate deployment and restarts for every writer rather than relying on the schema version alone.

Keep the development server private. Do not expose credentials in frontend environment variables, logs or source control.
