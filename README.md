# Roomlings

Shared chores, shopping, bills and repayments in a 3D home. Tracks money; never moves it.

## Installation

Requires **Node.js 22.18+**.

```sh
npm ci
npm run preview:local
```

Open http://localhost:5173. API: port `4311`.

## Usage

- [User guide](docs/usage.md) and [email sign-in setup](docs/accounts.md).
- Desktop web; [native app](https://github.com/lucadumi/roomlings-ios) for iPhone and iPad.
- [Configuration](.env.example) and [storage/deployment](docs/storage.md).

## Contributing

```sh
npm test
npm run build
npm run test:browser
```

Browser setup: `npx playwright install chromium`. See [contributor rules](AGENTS.md) and [branding](docs/branding.md).
