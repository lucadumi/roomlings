// TEXT deliberately preserves the original household JSON byte-for-byte on migration.
// Rules and integer-cent calculations remain in the shared domain helpers.
export const applicationSchemaVersion = 4
export const accountRecoveryTables = ['account_recovery_settings', 'account_recovery_codes'] as const
export const accountRecoverySchema = `
CREATE TABLE IF NOT EXISTS account_recovery_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_recovery_codes (
  hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES account_recovery_settings(account_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS account_recovery_codes_account ON account_recovery_codes(account_id);
`
export const roomAccessTables = ['household_room_owners', 'household_room_admins'] as const
export const roomAccessSchema = `
CREATE TABLE IF NOT EXISTS household_room_owners (
  household_id TEXT PRIMARY KEY REFERENCES households(id), member_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS household_room_admins (
  household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
  PRIMARY KEY(household_id, member_id)
);
`
export const notificationTables = ['notification_preferences', 'push_devices', 'notification_events', 'notification_deliveries'] as const
export const notificationIndexes = [
  'push_devices_token', 'push_devices_session', 'notification_events_dedup', 'notification_events_expiry',
  'notification_deliveries_device', 'notification_deliveries_ready', 'notification_deliveries_event_device',
] as const
export const notificationSchema = `
CREATE TABLE IF NOT EXISTS notification_preferences (
  household_id TEXT NOT NULL, member_id TEXT NOT NULL,
  chores INTEGER NOT NULL CHECK(chores IN (0, 1)), money INTEGER NOT NULL CHECK(money IN (0, 1)),
  updated_at TEXT NOT NULL, PRIMARY KEY(household_id, member_id),
  FOREIGN KEY(household_id, member_id) REFERENCES account_memberships(household_id, member_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS push_devices (
  installation_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES account_sessions(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK(environment IN ('sandbox', 'production')),
  token_hash TEXT NOT NULL, token_ciphertext TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_token ON push_devices(token_hash, environment);
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_session ON push_devices(session_id);
CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('chores', 'expense', 'settlement')),
  entity_id TEXT, local_date TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_events_dedup ON notification_events(dedup_key);
CREATE INDEX IF NOT EXISTS notification_events_expiry ON notification_events(expires_at);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL REFERENCES push_devices(installation_id) ON DELETE CASCADE, member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'sent', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), next_attempt_at TEXT NOT NULL,
  claim_token TEXT, claim_until TEXT, finished_at TEXT, last_error TEXT
);
CREATE INDEX IF NOT EXISTS notification_deliveries_device ON notification_deliveries(installation_id);
CREATE INDEX IF NOT EXISTS notification_deliveries_ready ON notification_deliveries(status, next_attempt_at, claim_until);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_event_device ON notification_deliveries(event_id, installation_id);
`
export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
${roomAccessSchema}
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
  id TEXT, label TEXT NOT NULL DEFAULT 'Saved browser', created_at TEXT, last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_member ON sessions(household_id, member_id);
CREATE TABLE IF NOT EXISTS recovery_codes (
  household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE, version INTEGER NOT NULL CHECK(version > 0), updated_at TEXT NOT NULL,
  PRIMARY KEY(household_id, member_id)
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, provider_id TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL, deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN (0, 1))
);
${accountRecoverySchema}
CREATE TABLE IF NOT EXISTS deleted_account_providers (hash TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  selected_household_id TEXT REFERENCES households(id)
);
CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions(account_id);
CREATE TABLE IF NOT EXISTS household_accounts (
  household_id TEXT PRIMARY KEY REFERENCES households(id), owner_member_id TEXT
);
CREATE TABLE IF NOT EXISTS account_memberships (
  household_id TEXT NOT NULL REFERENCES households(id), member_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  PRIMARY KEY(household_id, member_id), UNIQUE(household_id, account_id)
);
CREATE TABLE IF NOT EXISTS account_invitations (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id), hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, uses INTEGER NOT NULL DEFAULT 0 CHECK(uses >= 0)
);
CREATE TABLE IF NOT EXISTS account_invitation_uses (
  invitation_id TEXT NOT NULL REFERENCES account_invitations(id),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, PRIMARY KEY(invitation_id, account_id)
);
${notificationSchema}
`

export const applicationTables = [
  'households', ...roomAccessTables, 'sessions', 'recovery_codes', 'accounts', ...accountRecoveryTables, 'deleted_account_providers',
  'account_sessions', 'household_accounts', 'account_memberships', 'account_invitations', 'account_invitation_uses',
  ...notificationTables,
] as const

export const tableColumns = {
  households: ['id', 'invite', 'state'],
  household_room_owners: ['household_id', 'member_id'],
  household_room_admins: ['household_id', 'member_id'],
  sessions: ['hash', 'household_id', 'member_id', 'id', 'label', 'created_at', 'last_used_at'],
  recovery_codes: ['household_id', 'member_id', 'hash', 'version', 'updated_at'],
  accounts: ['id', 'provider_id', 'email', 'name', 'created_at', 'deleting'],
  account_recovery_settings: ['account_id', 'version', 'updated_at'],
  account_recovery_codes: ['hash', 'account_id'],
  deleted_account_providers: ['hash'],
  account_sessions: ['id', 'hash', 'account_id', 'label', 'created_at', 'last_used_at', 'expires_at', 'selected_household_id'],
  household_accounts: ['household_id', 'owner_member_id'],
  account_memberships: ['household_id', 'member_id', 'account_id', 'active'],
  account_invitations: ['id', 'household_id', 'hash', 'created_at', 'expires_at', 'revoked_at', 'uses'],
  account_invitation_uses: ['invitation_id', 'account_id'],
  notification_preferences: ['household_id', 'member_id', 'chores', 'money', 'updated_at'],
  push_devices: ['installation_id', 'account_id', 'session_id', 'environment', 'token_hash', 'token_ciphertext', 'revision', 'updated_at'],
  notification_events: ['id', 'dedup_key', 'household_id', 'kind', 'entity_id', 'local_date', 'created_at', 'expires_at'],
  notification_deliveries: [
    'id', 'event_id', 'installation_id', 'member_id', 'status', 'attempts', 'next_attempt_at',
    'claim_token', 'claim_until', 'finished_at', 'last_error',
  ],
} as const
