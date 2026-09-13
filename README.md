# Roomlings

Shared chores, shopping, bills and repayments in an interactive 3D home. Roomlings records payments; it never moves money.

## What it does

- Plan grocery runs with a shared list and individual shopping baskets.
- Assign one-off or recurring chores across the kitchen, bathroom, living room and whole home.
- Split paid groceries and recurring bills, follow the monthly grocery budget and record repayments.
- Share a household through verified-email accounts, invitations and saved access.
- Customize all three rooms with optional appliances, furniture and decorations, kept tidy by zone filters, placement limits and reversible storage.
- Give room admins editing access while everyone uses the same supplies, chores and manually recorded object states.

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run preview:local
```

Open http://localhost:5173 (API: port 4311). Explore the rooms on the public landing page, then use **Get started** in the hero or **Sign in** in the header to create or join a household.

| Entry | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/rooms/kitchen`, `/rooms/bathroom`, `/rooms/living-room` | Personal rooms and sign-in |

Email sign-in needs [Supabase setup](docs/accounts.md). Existing real browser access and recovery remain supported. Public room previews do not create households or anonymous sessions.

## Devices

Households run in desktop browsers. Phones and tablets always get the landing page instead, whatever the address, and their saved access stays stored. iPhone and iPad see the Roomlings app, which is still in development, so its **Download** and **Start sharing** buttons are disabled. Android and other handhelds see the same page with a note that Roomlings is for iPhone and iPad only. Detection follows device identity, including iPadOS desktop mode, so narrow desktop windows keep web signup and sign-in. Room exploration stays open everywhere.

Inside a household, toolbars and panels adapt to the window's width and height. Smaller windows use tighter controls, icon-only docks and toolbar actions with accessible names and tooltips. The household and room icons sit together in compact windows. Object markers retain a larger invisible hit area around their smaller visible circles. Camera controls remain vertical on the right and scroll when necessary. Form submission and confirmation buttons keep explicit labels.

## Development

TypeScript, React and Three.js power the client. Express serves the API, with SQLite by default and optional Postgres storage. All rooms share household access, chores, shopping and financial history.

Text, icons, controls, padding, margins, panels and artwork share a bounded `rem` scale driven by both window width and height, with readable minimums for body text, fields and touch targets. The scale respects the browser's base font size; device identity, not window size, selects the landing.

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

Use [.env.example](.env.example) for configuration. Keep credentials and databases out of Git, back up `data/kitchen.sqlite`, and follow the [migration guide](docs/storage.md) before switching storage engines. Production requires HTTPS and complete account configuration. Existing browser identities and `coldshare.*` storage remain supported, and linking an account preserves the original household history.

## Guides

- [Using Roomlings](docs/usage.md)
- [Accounts and email setup](docs/accounts.md)
- [Storage, migration and deployment](docs/storage.md)
- [Branding, logo sources and the 2D loader](docs/branding.md)
- [Contributor rules](AGENTS.md)
