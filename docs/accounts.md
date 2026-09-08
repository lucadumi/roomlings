# Accounts and email

Supabase Auth verifies email codes. Roomlings keeps its own server-validated sessions in `HttpOnly` cookies; provider tokens, email codes and account credentials never enter browser storage.

## Setup

1. Create a Supabase project and enable Email authentication with email confirmation.
2. Configure custom SMTP under **Authentication > Emails > SMTP Settings**. Use your mail provider's credentials, not a Supabase project key. Hosted template editing may require SMTP first. Do not disable confirmation to work around delivery failures.
3. Update both **Confirm signup** and **Magic Link (or OTP)** templates. Use **Your Roomlings sign-in code** as the subject and [emails/auth-code.html](../emails/auth-code.html) as the body. Both templates need `{{ .Token }}`, not a confirmation link. Set an appropriate short OTP lifetime.
4. Copy the account variables from [.env.example](../.env.example) into the ignored `.env`. Keep the project URL, publishable key and administrative credential on the Express server, never in `VITE_*` variables.
5. Set `APP_ORIGIN=http://localhost:5173` for review, or an HTTPS origin for production. Configure reverse proxies deliberately rather than trusting arbitrary forwarded IP headers.
6. Restart the API and request a fresh code through sign-in. Template changes apply only to new emails.

Without provider configuration, local sample kitchens and browser recovery still work; email sign-in reports that setup is required. Partial configuration fails explicitly. Production refuses to start without complete account configuration and an HTTPS origin.

### Sender and template

Verify a domain with your mail provider and set the sender name to **Roomlings**. Resend's `onboarding@resend.dev` address is limited to private testing with the account owner's email, not roommate invitations or public signups.

SMTP credentials belong in Supabase settings, not browser code or this repository. The administrative Supabase credential supports provider-side account deletion; it does not configure SMTP or hosted templates.

The local template has no external assets, tracking or sign-in links. Copying it into the repository does not update Supabase. Enter the newest code in the app rather than following an old email's confirmation link.

References: [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp), [templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Account recovery codes

Account recovery codes provide another way to sign in when email delivery or mailbox access is unavailable. They belong to the Roomlings account, not to an individual browser-only kitchen.

1. Sign in, open **Account and membership > Manage recovery codes**, and choose **Generate recovery codes**.
2. Save the ten single-use codes in a password manager or another private place. **Copy all recovery codes** copies the complete set. The codes are shown only once; closing the screen hides them permanently.
3. To return without an email code, choose **Use an account recovery code** on the sign-in screen. Enter the account email, one unused code, and a name for this browser, then choose **Recover my account**.
4. Use **Replace recovery codes** to create a new set and invalidate the previous one, or **Revoke recovery codes** to disable the unused codes without signing out existing devices.

Generating, replacing or revoking codes requires a sign-in within the previous ten minutes. A successful email or recovery-code sign-in provides that recent proof. If asked to sign in again, return to the recovery-code settings and confirm the change yourself; the app does not automatically repeat it.

Each code can create only one account session. Code consumption and session creation are one transaction, including concurrent requests. Only hashes are stored on the server, and neither the code list nor a pasted recovery code is put in URLs, localStorage or sessionStorage. Status requests return only the remaining count and the set's version and update time.

Recovery preserves the existing account, profile, active memberships and ledger. Other sessions remain signed in. Signing out all devices does not revoke unused account recovery codes; replace or revoke those separately if they may have been exposed. Account deletion disables the codes immediately, even if provider deletion is still pending. A recovery code cannot restore a removed household membership.

Existing Postgres deployments need the explicit schema upgrade in the [storage guide](storage.md) before running this version. SQLite adds the recovery tables on startup without rewriting existing accounts or household JSON.

## Existing kitchens and invitations

**Account and membership > Link existing kitchen access** links a saved browser identity or recovery code to the same member ID. It does not duplicate roommates or rewrite expenses, bills, shopping history or balances. Matching a name never claims an identity.

Saved browser kitchens are shortcuts, not proof of current access. When the server rejects a shortcut as expired or revoked, it stays visible as **Access expired**, with **Recover access** instead of another failed Open action. Temporary network or server failures leave Open available for retry. The status is retained in existing Roomlings and Coldshare storage without deleting the saved identity or its ledger.

Browser-only recovery requires the private kitchen code saved before browser access was lost. Signing in to an account, with either email or an account recovery code, restores that identity only if it was already linked to the account. Neither a matching name nor a kitchen invitation proves ownership of an old browser identity. The two kinds of recovery code are not interchangeable.

Older sample shortcuts are identified only after the server confirms that the household is a sample, never by its name. Confirmed samples are excluded from personal-kitchen and account-linking lists. Opening an older sample uses its existing access on the sample route without replacing a personal session or account preference.

The original creator remains owner; linking an account does not transfer ownership. One account can join several kitchens, but cannot claim two members in the same kitchen.

Account-managed invitations last seven days and reveal their secret only when created. Owners can revoke them. Recipients sign in before accepting; reopening an accepted invitation does not add another roommate. Old browser invitation codes cannot bypass account-managed access.

## Sessions and membership

- Account sessions expire after 30 days, or seven days without use. Account settings support device labels, revocation and sign-out on one or all devices.
- Returning to the public home page or trying a sample does not replace an account session. Valid cookies reopen the room without another code; expired or revoked access prompts sign-in without erasing household data.
- Signing out all devices also revokes linked browser sessions. Unrelated saved browser identities stay separate.
- Owners manage invitations, remove access and transfer ownership. All active roommates can edit the shared ledger.
- Before leaving a kitchen with other members, its owner must transfer ownership.
- Leaving or removal revokes access and browser-only recovery codes for that kitchen, and releases shopping claims. Account recovery cannot rejoin it automatically. Financial history remains; leaving does not cancel debts.
- Record outstanding expenses before removing a member. New expenses require active participants, including backdated entries. Review existing future bill participants after membership changes.
- A kitchen supports 12 active members and 200 retained identities. Returning members keep their original ID but need an invitation created after removal.

## Account deletion

Deletion requires email confirmation, a sign-in within the previous ten minutes and any necessary ownership handoff. A sole remaining owner can close a kitchen without deleting its history.

Deletion removes sign-in identity and access, not shared financial records, debts or names written into descriptions. Export needed ledgers first.

If Supabase deletion fails, access is disabled and deletion remains pending. The server retries at startup and every minute; keep its administrative credential configured until completion. Do not present a queued deletion as successful.
