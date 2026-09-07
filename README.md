# Roomlings

Shared shopping, bills and repayments, built around an interactive 3D kitchen. Roomlings records payments; it never moves money.

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run preview:local
```

Open http://localhost:5173. Sign in to create a household, or explore a sample without signing in. Email sign-in needs [Supabase setup](docs/accounts.md); local storage defaults to SQLite.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Reload frontend and API while editing |
| `npm test` | Domain, API and persistence tests |
| `npm run test:browser` | Browser flows |
| `npm run build` | Type-check and build |

Restart `preview:local` after server, schema or `.env` changes. Browser tests need Chromium: `npx playwright install chromium`.

## Guides

- [Using Roomlings](docs/usage.md)
- [Accounts and email setup](docs/accounts.md)
- [Storage, migration and deployment](docs/storage.md)
- [Branding, logo sources and the 2D loader](docs/branding.md)
- [Contributor rules](AGENTS.md)
