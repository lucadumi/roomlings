# Storage and deployment

Run commands from the repository root. Keep database files, credentials, recovery codes and backups out of Git.

## Local storage

SQLite is the default, at `data/kitchen.sqlite`. Back it up before operational changes. [.env.example](../.env.example) documents `DATA_DIR`, `HOST` and `PORT`; the Vite proxy expects the API on port 4311.

SQLite startup adds the account-recovery tables transactionally while retaining existing account, browser-session and kitchen data. Postgres requires the explicit upgrade below.

Use `npm run preview:local` for a stable API with frontend hot reload. Restart it after server, schema or environment changes. `npm run dev` also watches the API.

## Postgres

Set `DATABASE_DRIVER=postgres`, a server-only `DATABASE_URL`, and `DATABASE_SCHEMA=roomlings`. Invalid configuration fails rather than silently falling back to SQLite.

For Supabase over IPv4, use the **Connect > Session pooler** URI. Download the CA certificate from **Database > Settings > SSL Configuration** and set `DATABASE_SSL_ROOT_CERT` to its path. Certificate and hostname verification remain enabled. `DATABASE_TLS=disable` is only for explicit loopback development/test databases.

Application tables live in the `roomlings` schema, not Supabase's managed `auth` schema. RLS is enabled and browser roles have no application-schema privileges; Express enforces authorization.

Household JSON remains canonical text, preserving IDs, integer cents, versions and historical references. Both engines share storage rules. SQLite serializes its connection; Postgres transactions pin a connection and use a schema-wide advisory lock to prevent lost updates and preserve account/deletion invariants.

## Postgres schema upgrades

Application schema version 2 adds only `account_recovery_settings`, `account_recovery_codes` and their indexes. The version 1 to 2 upgrade is additive: it does not rewrite existing rows, rotate sessions, change account/member IDs or recalculate the ledger. It does not generate recovery codes. Subsequent account operations store only hashes of the ten single-use codes.

Startup only checks the supported version. It never applies Postgres DDL or falls back to SQLite when a schema is old, absent or unsupported.

1. Confirm which applications use the target database and schema, and obtain approval before changing a shared database. A local worktree or `localhost` preview can still use shared Postgres; another branch is not database isolation. Coordinate a maintenance window and compatible application builds for every process using that schema.
2. Stop application writers and take a consistent Postgres backup or provider snapshot, including the application schema, `schema_migrations`, data and privileges. Verify the restoration procedure and keep the backup outside Git. The upgrade command does not create a Postgres backup; `--source` and `--backup` are SQLite-import flags and are rejected with `--upgrade`.
3. Put the intended target settings in the ignored `.env.migration` file, as for SQLite migration. Use the same trusted server-side database role that owns and operates the application schema and tables, so the running API also owns the new private tables. Inspect the read-only plan:

   ```sh
   npm run database:migrate -- --upgrade
   ```

   The JSON result contains `schema`, `fromVersion`, `toVersion` and `applied`. A pending upgrade reports versions `1` and `2` with `applied: false`. Dry runs inspect metadata under the shared advisory lock without writing tables, privileges or migration records. Supplying confirmation without `--apply` is still a dry run.

4. Only after reviewing the target and backup, explicitly apply to the exact configured schema name:

   ```sh
   npm run database:migrate -- --upgrade --apply --confirm-schema roomlings
   ```

   Both flags are required to mutate. Missing or mismatched confirmation, absent/unversioned schemas, unsupported versions and conflicting recovery objects fail without upgrading. The recovery DDL, RLS, schema/table/default-privilege protections and version 2 record commit together under the same transaction and advisory lock used by application operations. A failure rolls the whole upgrade back. Browser roles retain no application-schema or recovery-table access.

5. After success, restart the API with the schema-version-2-compatible build and matching Postgres settings. `preview:local` does not watch API files, so its API needs an explicit coordinated restart. Verify existing sign-ins, household membership and ledger data without clearing browser storage or replacing session tokens. Repeating either upgrade command on version 2 safely returns `applied: false` with both versions set to `2`; it does not replace codes or append a migration record.

**Compatibility and rollback:** older version-1 application builds reject a version-2 database when they start or restart, even though the DDL is additive. Do not upgrade a shared preview database while another feature still requires an incompatible build. Reverting the checkout alone is not a rollback, and there is no automatic down migration. Do not drop recovery tables or edit migration markers to bypass version checks. Prefer a compatible forward fix. Restoring a version-1 backup requires stopping all writers and restoring the complete approved backup with a matching application build; after version-2 writes, restoration would lose those newer data, code and session changes unless they are reconciled.

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

Migration backs up committed WAL data, validates balances and references, refuses a populated target, copies all application tables transactionally and compares every imported row. Account-recovery metadata and unused-code hashes are included, preserving code usability and single-use state after cutover. It never deletes the original SQLite database. Startup checks the supported schema version; it does not apply Postgres migrations automatically.

**Rollback:** before any Postgres writes, stop the server and select SQLite with the original `DATA_DIR`. After Postgres accepts data or account changes, do not switch to an older SQLite copy without reconciliation or an explicit point-in-time recovery.

Postgres tests require `TEST_DATABASE_URL`; they use disposable `roomlings_test_*` schemas and never fall back to `DATABASE_URL`. CI supplies its own Postgres service. `node --test tests/postgres-upgrade.test.ts` checks upgrade and CLI safety without a database connection. Real upgrade, rollback, privacy, cross-connection single-use recovery and SQLite-import parity coverage lives in `tests/postgres.test.ts`; that suite skips without `TEST_DATABASE_URL`, and skipped tests are not database validation.

## Deployment

Build with `npm run build`, then serve the build and API with `npm start`. Configure [Supabase accounts](accounts.md), HTTPS, the correct `APP_ORIGIN`, mail delivery, abuse limits, backups and a privacy/retention policy first.

Keep the development server private. Do not expose credentials in frontend environment variables, logs or source control.
