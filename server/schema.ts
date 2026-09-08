// TEXT deliberately preserves the original household JSON byte-for-byte on migration.
// Rules and integer-cent calculations remain in the shared domain helpers.
export const applicationSchemaVersion = 2
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
export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, invite TEXT UNIQUE NOT NULL, state TEXT NOT NULL);
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
`

export const applicationTables = [
  'households', 'sessions', 'recovery_codes', 'accounts', ...accountRecoveryTables, 'deleted_account_providers',
  'account_sessions', 'household_accounts', 'account_memberships', 'account_invitations', 'account_invitation_uses',
] as const

export const tableColumns = {
  households: ['id', 'invite', 'state'],
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
} as const
