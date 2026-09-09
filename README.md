# Roomlings

Shared chores, shopping, bills and repayments in an interactive 3D home. Roomlings records payments; it never moves money.

## What it does

- Plan grocery runs with a shared list and individual shopping baskets.
- Assign one-off or recurring chores across the kitchen, bathroom and whole home.
- Split paid groceries and recurring bills between the people sharing them.
- Track the monthly grocery budget and record roommate repayments.
- Share a household through verified-email accounts, invitations and saved access.
- Customize the kitchen and bathroom with optional appliances, furniture and decorations across compatible, live-previewed positions.
- Give room admins editing access while everyone uses the same supplies, chores and manually recorded object states.

The room's objects open these tools, and a toolbar keeps them available without 3D. **Room objects** groups each kind into one preview card, with position choices for repeated objects. Its **Edit room** action lets admins preview and apply a shared layout. Installing or moving an object never creates a purchase, debt or chore. Every balance comes from the same shared ledger.

The object library includes kitchen appliances, shared-care tools and decorative pieces such as a stand mixer, mug tree, record player, board game and reed diffuser. **Rooms** opens a compact preview menu directly beneath its button.

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run preview:local
```

Open http://localhost:5173 (API: port 4311). Explore the rooms on the public landing page, then sign in to create or join your household.

| Entry | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/rooms/kitchen`, `/rooms/bathroom` | Personal rooms and sign-in |

Email sign-in needs [Supabase setup](docs/accounts.md). Existing real browser access and recovery remain supported. Public room previews do not create households or anonymous sessions.

## Development

TypeScript, React and Three.js power the client. Express serves the API, with SQLite by default and optional Postgres storage. Kitchen and bathroom share household access, chores, shopping and financial history; room registration supports further expansion.

| Command | Purpose |
| --- | --- |
| `npm run preview:local` | Stable API and live frontend for review |
| `npm run dev` | Reload frontend and API while editing |
| `npm test` | Domain, API and persistence tests |
| `npm run test:browser` | Browser flows |
| `npm run build` | Type-check and build |
| `npm start` | Serve the production build and API |

Restart `preview:local` after server, schema or `.env` changes. Browser tests need Chromium: `npx playwright install chromium`.

## Data and configuration

Use [.env.example](.env.example) for configuration. Keep credentials and databases out of Git, back up `data/kitchen.sqlite`, and follow the [migration guide](docs/storage.md) before switching storage engines. Production requires HTTPS and complete account configuration.

Existing browser identities and `coldshare.*` storage remain supported. Linking an account preserves the original household history.

## Guides

- [Using Roomlings](docs/usage.md)
- [Accounts and email setup](docs/accounts.md)
- [Storage, migration and deployment](docs/storage.md)
- [Branding, logo sources and the 2D loader](docs/branding.md)
- [Contributor rules](AGENTS.md)
