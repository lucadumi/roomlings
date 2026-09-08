# Roomlings

Shared shopping, bills and repayments, built around an interactive 3D kitchen. Roomlings records payments; it never moves money.

## What it does

- Plan grocery runs with a shared list and individual shopping baskets.
- Split paid groceries and recurring bills between the people sharing them.
- Track the monthly grocery budget and record roommate repayments.
- Share a household through verified-email accounts, invitations and saved access.

The room's objects open these tools, and a toolbar keeps them available without 3D. Every balance comes from the same shared ledger.

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run preview:local
```

Open http://localhost:5173 (API: port 4311). Sign in to create a household, or try a private sample without signing in. The sample uses separate access and never changes a personal household.

| Entry | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/rooms/kitchen` | Personal room and sign-in |
| `/sample/kitchen` | Anonymous sample room |

Email sign-in needs [Supabase setup](docs/accounts.md). Without it, local samples and existing browser recovery still work.

## Development

TypeScript, React and Three.js power the client. Express serves the API, with SQLite by default and optional Postgres storage. Only the kitchen is currently interactive; room registration supports adding more rooms to the same household.

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
