# Storage and deployment

Run commands from the repository root. Keep database files, credentials, recovery codes and backups out of Git.

## Local storage

SQLite is the default, at `data/kitchen.sqlite`. Back it up before operational changes. [.env.example](../.env.example) documents `DATA_DIR`, `HOST` and `PORT`; the Vite proxy expects the API on port 4311.

Use `npm run preview:local` for a stable API with frontend hot reload. Restart it after server, schema or environment changes. `npm run dev` also watches the API.

## Postgres

Set `DATABASE_DRIVER=postgres`, a server-only `DATABASE_URL`, and `DATABASE_SCHEMA=roomlings`. Invalid configuration fails rather than silently falling back to SQLite.

For Supabase over IPv4, use the **Connect > Session pooler** URI. Download the CA certificate from **Database > Settings > SSL Configuration** and set `DATABASE_SSL_ROOT_CERT` to its path. Certificate and hostname verification remain enabled. `DATABASE_TLS=disable` is only for explicit loopback development/test databases.

Application tables live in the `roomlings` schema, not Supabase's managed `auth` schema. RLS is enabled and browser roles have no application-schema privileges; Express enforces authorization.

Household JSON remains canonical text, preserving IDs, integer cents, versions and historical references. Both engines share storage rules. SQLite serializes its connection; Postgres transactions pin a connection and use a schema-wide advisory lock to prevent lost updates and preserve account/deletion invariants.

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

Migration backs up committed WAL data, validates balances and references, refuses a populated target, copies all application tables transactionally and compares every imported row. It never deletes the original SQLite database. Startup checks the supported schema version; it does not apply migrations automatically.

**Rollback:** before any Postgres writes, stop the server and select SQLite with the original `DATA_DIR`. After Postgres accepts data or account changes, do not switch to an older SQLite copy without reconciliation or an explicit point-in-time recovery.

Postgres tests require `TEST_DATABASE_URL`; they use disposable `roomlings_test_*` schemas and never fall back to `DATABASE_URL`. CI supplies its own Postgres service.

## Deployment

Build with `npm run build`, then serve the build and API with `npm start`. Configure [Supabase accounts](accounts.md), HTTPS, the correct `APP_ORIGIN`, mail delivery, abuse limits, backups and a privacy/retention policy first.

Keep the development server private. Do not expose credentials in frontend environment variables, logs or source control.
