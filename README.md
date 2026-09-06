# Roomlings

A game-like shared kitchen for groceries, monthly bills and fair repayments. Built with React, Three.js, Express and SQLite. **Roomlings records payments; it never moves money.**

## Run locally

Requires Node.js 22.18+.

```sh
npm install
npm run dev
```

Open http://localhost:5173 (API: port 4311). Start with the private sample kitchen, or choose **Make it yours** and invite your roommates.

## Use

- **Shopping bag:** add groceries and split them in integer cents.
- **Receipt book:** browse groceries or create, edit and pause monthly bills in **Bills**. Confirm the actual amount and payer to record one expense per bill/month.
- **House pot and fridge:** grocery-only spending and purchases. Bills share the same balances and repayments, not the grocery budget.
- **Envelope:** record or undo roommate repayments. Export the complete ledger from the receipt book.
- **The roommates:** manage browser sessions and recovery codes. Use **Recover existing access** or `/#recover` on another browser.

Bill dates use the first creator's time zone. Edits preserve earlier months and recorded payments. Pauses stop future months; resuming never backfills skipped months. Short months use their last day.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Domain, API and persistence tests |
| `npm run test:browser` | Browser flows; install Chromium with `npx playwright install chromium` if missing |
| `npm run build` | Type-check and build |
| `npm start` | Serve the production build and API |

## Data and sharing

- Back up `data/kitchen.sqlite`. `.env.example` documents `PORT`, `HOST` and `DATA_DIR`; the development proxy in `vite.config.ts` targets port 4311.
- Keep invitations, session tokens and recovery codes private. All roommates can edit the ledger. Codes work until replaced; losing both the code and all active sessions requires rejoining as a new roommate. Legacy `coldshare.*` keys remain supported.
- For other devices, build and run behind HTTPS and access controls. Never expose the development server.

## Contributing

See [AGENTS.md](AGENTS.md) for design, testing and approval rules. Publication and merging require separate approval.

Interaction references: [Apple ornaments](https://developer.apple.com/design/human-interface-guidelines/ornaments), [Tiny Room Planner](https://github.com/crayonzgrim/3d-room-planner).
