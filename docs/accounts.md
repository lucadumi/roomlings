# Accounts and email

Supabase Auth verifies email codes. Roomlings keeps its own server-validated sessions in `HttpOnly` cookies for browsers and bearer tokens for the native iOS app. Provider tokens, email codes and account credentials never enter browser storage.

## Setup

1. Create a Supabase project and enable Email authentication with email confirmation.
2. Configure custom SMTP under **Authentication > Emails > SMTP Settings**. Use your mail provider's credentials, not a Supabase project key. Hosted template editing may require SMTP first. Do not disable confirmation to work around delivery failures.
3. Create a public Storage bucket named `brand` and upload [roomlings-icon-flat-256.png](../public/brand/roomlings-icon-flat-256.png). The email header loads the mark from its public URL.
4. Update both **Confirm signup** and **Magic Link (or OTP)** templates. Use **Your Roomlings sign-in code** as the subject and [emails/auth-code.html](../emails/auth-code.html) as the body. Replace `YOUR-PROJECT-REF` in the image address with your project reference. Both templates need `{{ .Token }}`, not a confirmation link. Set an appropriate short OTP lifetime.
5. Copy the account variables from [.env.example](../.env.example) into the ignored `.env`. Keep the project URL, publishable key and administrative credential on the Express server, never in `VITE_*` variables.
6. Set `APP_ORIGIN=http://localhost:5173` for review, or an HTTPS origin for production. Configure reverse proxies deliberately rather than trusting arbitrary forwarded IP headers.
7. Restart the API and request a fresh code through sign-in. Template changes apply only to new emails.

Without provider configuration, browser-only kitchens and browser recovery still work; email sign-in reports that setup is required. Partial configuration fails explicitly. Production refuses to start without complete account configuration and an HTTPS origin.

Provider configuration and gateway failures report that email sign-in is unavailable, rather than incorrectly asking for a different email code. Invalid or expired email codes still require a fresh code.

### Sender and template

Verify a domain with your mail provider and set the sender name to **Roomlings**. Resend's `onboarding@resend.dev` address is limited to private testing with the account owner's email, not roommate invitations or public signups.

SMTP credentials belong in Supabase settings, not browser code or this repository. The administrative Supabase credential supports provider-side account deletion; it does not configure SMTP or hosted templates.

The template loads one image, the Roomlings mark from the public `brand` bucket, and nothing else. There are no tracking pixels and no sign-in links, and the header falls back to the text wordmark when a client blocks images. Copying the file into the repository does not update Supabase. Enter the newest code in the app rather than following an old email's confirmation link.

References: [Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless#with-otp), [templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Native iOS sessions

The separate Swift app uses the same accounts, household memberships and ledger as the web app. No database migration, second identity system or Supabase credentials in the client are needed.

Send `X-Roomlings-Client: ios` on native account and household requests. This header selects the session transport; it is not authentication. Native requests never fall back to cookies or legacy kitchen tokens. Unsupported client values return `400 CLIENT_UNSUPPORTED`.

Use HTTPS, except for loopback during local development. Configure `URLSession` without cookie storage or automatic cookie handling, and do not send `Origin` or `Sec-Fetch-Site`. Requests carrying either browser header are rejected with `403 NATIVE_CLIENT_REQUIRED`, even with valid credentials. The browser's origin checks and CSRF requirements remain unchanged; do not enable cross-origin access to make a native client work.

### Signing in

1. Call `POST /api/account/code` with `{ "email": "you@example.com" }`.
2. Call `POST /api/account/verify` with `email`, the emailed `code`, `name` and a device `label`, such as `iPhone` or `iPad`. The same Zod validation and rate limits apply to browser and native requests together.
3. A successful native verification returns the ordinary account state plus `accessToken`, validated by `nativeAccountSignInSchema` in `shared/accounts.ts`. Store the token in the iOS Keychain, not `UserDefaults`, URLs, logs or analytics. Use a device-only Keychain accessibility policy appropriate for foreground access.
4. Send `Authorization: Bearer <accessToken>` together with `X-Roomlings-Client: ios` on subsequent requests.

`POST /api/account/recover` accepts `email`, one unused account recovery `code`, and a device `label`. It returns the same native sign-in response without requiring email delivery.

Only successful native verification and recovery responses contain `accessToken`. No native response sets or clears a browser cookie. Ordinary account reads and mutations return the existing account state without reissuing the token. Browser responses never include the native token. The account state's `csrfToken` remains present for schema compatibility but is not used by the native client, and `session.token` remains `null`; neither is the bearer credential.

When reauthenticating, include the current bearer token. A successful sign-in replaces only that session and retains the same account's selected active household. Without a current bearer, signing in creates another device session, even if a cookie accompanies the request. Failed sign-ins preserve the existing session. Recovery-code consumption, token creation and response validation are atomic; a failure before commit does not consume the code or revoke the previous session.

A response lost after commit cannot be replayed to retrieve the new token. Do not automatically repeat email verification or recovery as if they were idempotent writes. If the token was not received, use a fresh email code or another unused recovery code.

### Using the shared API

Use the existing `/api/account` endpoints for profile, devices, recovery settings, invitations, household creation, selection and deletion. Use `/api/household`, `/api/expenses`, `/api/chores`, `/api/shopping` and the other existing household routes for shared activity. Native tokens are Roomlings account sessions, not Supabase provider tokens or legacy browser-only kitchen credentials.

`X-Roomlings-Household: <household UUID>` targets an active membership for that request without changing the device's selected household. Without it, household routes use the selected household. The server checks membership and room permissions on every request.

Money stays in integer cents. Household mutations retain the existing `version` requirement and optional `mutationId`/`mutationVersion` retry receipts. Household creation retains its optional `requestId`. A client preview must never replace the server's ledger or bypass a version conflict.

### Expiry, sign-out and deletion

Native sessions use the existing 30-day absolute lifetime, seven-day idle lifetime and 50-device account limit. There is no separate refresh token. `GET /api/account` returns a signed-out state when the bearer is missing, invalid, expired or revoked; protected requests return `401 ACCOUNT_SESSION_REQUIRED`. Clear the local credential after confirmed sign-out or expiry, not after network failures or server errors.

Device revocation and sign-out work across native and browser sessions. `POST /api/account/logout` with `{ "all": false }` revokes only the authenticated native session; `{ "all": true }` also revokes the account's other sessions and linked legacy browser access. An unrelated accompanying cookie is never used or cleared.

Recovery-code management and deletion still require a sign-in within the previous ten minutes. `401 REAUTHENTICATION_REQUIRED` means the user must sign in again before explicitly confirming the action. `503 ACCOUNT_DELETION_PENDING` is not successful deletion: retain the current credential for the deletion-only retry, hide household access, and follow `deletionPending` from `GET /api/account`. Clear the Keychain token after deletion succeeds.

## Account recovery codes

Account recovery codes provide another way to sign in when email delivery or mailbox access is unavailable. They belong to the Roomlings account, not to an individual browser-only kitchen.

1. Sign in, open **Account and membership > Manage recovery codes**, and choose **Generate recovery codes**.
2. Save the ten single-use codes in a password manager or another private place. **Copy all recovery codes** copies the complete set. The codes are shown only once; closing the screen hides them permanently.
3. To return without an email code, choose **Use an account recovery code** on the sign-in screen. Enter the account email, one unused code, and a name for this browser, then choose **Recover my account**.
4. Use **Replace recovery codes** to create a new set and invalidate the previous one, or **Revoke recovery codes** to disable the unused codes without signing out existing devices.

Generating, replacing or revoking codes requires a sign-in within the previous ten minutes. A successful email or recovery-code sign-in provides that recent proof. If asked to sign in again, return to the recovery-code settings and confirm the change yourself; the app does not automatically repeat it.

Each code can create only one account session. Code consumption, session creation and preparation of the signed-in account state share one transaction, including concurrent requests. A server failure before that transaction commits leaves the code unused. A response lost after commit does not undo consumption; check whether this browser is signed in before trying another unused code.

Only hashes are stored on the server, and neither the code list nor a pasted recovery code is put in URLs, localStorage or sessionStorage. Status requests return only the remaining count and the set's version and update time.

Recovery preserves the existing account, profile, active memberships and ledger. Other browsers remain signed in; recovery replaces only this browser's current account session, if any. Signing out all devices does not revoke unused account recovery codes; replace or revoke those separately if they may have been exposed. Account deletion disables the codes immediately, even if provider deletion is still pending. A recovery code cannot restore a removed household membership.

Existing Postgres deployments need the explicit schema upgrade in the [storage guide](storage.md) before running this version. SQLite adds the recovery tables on startup without rewriting existing accounts or household JSON.

## Existing kitchens and invitations

**Account and membership > Link existing kitchen access** links a saved browser identity or recovery code to the same member ID. It does not duplicate roommates or rewrite expenses, bills, shopping history or balances. Matching a name never claims an identity.

Saved browser kitchens are shortcuts, not proof of current access. When the server rejects a shortcut as expired or revoked, it stays visible as **Access expired**, with **Recover access** instead of another failed Open action. Temporary network or server failures leave Open available for retry. The status is retained in existing Roomlings and Coldshare storage without deleting the saved identity or its ledger.

Browser-only recovery requires the private kitchen code saved before browser access was lost. Signing in to an account, with either email or an account recovery code, restores that identity only if it was already linked to the account. Neither a matching name nor a kitchen invitation proves ownership of an old browser identity. The two kinds of recovery code are not interchangeable.

Households previously stored with the retired example marker remain unchanged in storage, but their old browser sessions, recovery codes, invitations and account memberships no longer grant access. They are never converted into real kitchens or linkable account identities. Legitimate older kitchens stored with the original false marker remain readable and can continue normally.

The original creator remains owner; linking an account does not transfer ownership. One account supports up to 50 active kitchens, but cannot claim two members in the same kitchen. The limit applies equally to creation, invitation acceptance and linking existing browser access. A kitchen already linked to the account can still be reopened at the limit.

### Creation retries

`POST /api/account/households` accepts an optional `requestId` UUID alongside `name`, `memberName`, `currency` and `budget`. Keep the same ID and details when retrying an interrupted creation, including after signing in again. Successful retries return the current account state with the original kitchen selected, without creating another kitchen or overwriting later edits.

Use a new ID for an intentional separate creation, including another home with the same name. Reusing an ID with different normalized details returns `409 ACCOUNT_CREATION_CONFLICT`. Current membership is checked again, so a retry cannot restore removed access or transferred ownership. Requests without an ID retain the original creation behavior.

The creation receipt is saved atomically with the kitchen and membership, survives restarts and ordinary household saves, and is not part of public ledger responses. This requires no new SQL schema version.

### Invitations

Account-managed invitations last seven days and reveal their secret only when created. Owners can revoke them. Recipients sign in before accepting; reopening an accepted invitation does not add another roommate. Old browser invitation codes cannot bypass account-managed access.

## Room administration

The owner and delegated **admins** can add, remove and configure shared room components and change room style. An owner or admin can grant another active roommate admin rights, or revoke an admin's rights, through **Room admins**. Both actions require confirmation. Admins can also give up their own delegated rights.

Delegation does not transfer ownership. Only the owner can create or revoke account invitations, remove roommates, or transfer ownership. The owner's role cannot be changed through admin controls. All active members, including non-admins, keep ordinary shared ledger, shopping, chores and daily component-state access.

Browser-only identities and account-linked identities use the same member ID and permissions. The original creator's ID is retained separately from client household JSON; a different roommate linking an account first never becomes owner. In account-managed kitchens, the current stored owner takes precedence, including a closed kitchen with no owner. Names, account profile names and submitted role fields are never identity proof.

Leaving, removal and account deletion clear delegated rights in the same transaction that disables membership. A returning roommate retains their historical member ID but rejoins as a member, not an admin. An ownership transfer also removes any old delegation for the new or former owner; it does not leave hidden admin rights that can reappear later.

`GET /api/household/room-access` returns the authenticated `householdId`, `memberId`, household `version`, current `role`, and a roster of member IDs, names, roles and active status. `PATCH /api/household/room-access/:memberId` accepts `{ role: "admin" | "member", version }` and the existing optional `mutationId`/`mutationVersion` pair. It uses the same transaction, version conflicts, mutation receipts and `{ household }` response as other household mutations. Read access again when the household version changes; hiding UI controls is not authorization. The API checks current actor and target membership, rejects owner changes and no-op changes, and never trusts roles supplied in household JSON.

## Sessions and membership

- Account sessions expire after 30 days, or seven days without use. An account supports up to 50 saved devices across browsers and the native app. Account settings support device labels, revocation and sign-out on one or all devices.
- Signing in again rotates this browser's session instead of adding another saved device. It keeps the same account's selected active kitchen; other browsers stay signed in. Failed sign-ins leave the previous session intact.
- Returning to the public home page does not replace an account session. Valid cookies reopen the room without another code; expired or revoked access prompts sign-in without erasing household data.
- Signing out all devices also revokes linked browser sessions. Unrelated saved browser identities stay separate.
- Owners manage invitations, remove access and transfer ownership. Owners and admins configure rooms and manage delegated admin rights. All active roommates can edit the shared ledger.
- Before leaving a kitchen with other members, its owner must transfer ownership.
- Leaving or removal revokes access, delegated admin rights and browser-only recovery codes for that kitchen, and releases shopping claims. Account recovery cannot rejoin it automatically. Financial history remains; leaving does not cancel debts.
- Record outstanding expenses before removing a member. New expenses require active participants, including backdated entries. Review existing future bill participants after membership changes.
- A kitchen supports 12 active members and 200 retained identities. Returning members keep their original ID but need an invitation created after removal.

## Account deletion

Deletion requires email confirmation, a sign-in within the previous ten minutes and any necessary ownership handoff. A sole remaining owner can close a kitchen without deleting its history.

Deletion removes sign-in identity and access, not shared financial records, debts or names written into descriptions. Export needed ledgers first.

If Supabase deletion fails, access is disabled and deletion remains pending. The server retries at startup and every minute; keep its administrative credential configured until completion. Do not present a queued deletion as successful.

Reloading the browser that requested deletion retains its deletion-only status and **Retry account deletion** action. This exposes no household access, memberships or recovery codes, and does not restore other signed-in devices. The browser can finish the queued deletion without repeating the original ownership handoff.
