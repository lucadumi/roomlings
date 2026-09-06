# Roomlings

A shared home you can explore, with real household finances underneath. The first room is a cozy kitchen: unpack shopping bags into an animated fridge and manage shared groceries by interacting with the objects around you. Warm cream, sage and tomato colours, with self-hosted Fraunces and DM Sans.

This version contains the working kitchen and shared grocery ledger. Other rooms, rent and utility workflows, receipt uploads, and a separate mobile app are not implemented in this version.

## Run locally

Requires Node.js 22.18 or newer.

```sh
cd roomlings
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 4311. A clearly marked, private sample kitchen is created for the first visit. Click **Make it yours** to create a real household, then share its invitation.

```sh
npm test
npm run build
npm run test:browser
```

The browser suite uses Playwright Chromium. If it is not installed, run `npx playwright install chromium` first.

## What works

- Shared households with private invitation links and independent roommate sessions.
- A SQLite ledger that persists through server and browser restarts. Other sessions refresh every 12 seconds and when the tab regains focus.
- Expenses paid by any roommate and split equally among the selected people, with integer-cent arithmetic.
- Monthly budgets and category filters. The fridge shelves represent categories bought in the selected month, not an inventory or an expiry tracker. The coins in the house pot show the remaining monthly budget, not reward points or a bank balance.
- A game-first 3D kitchen with animated fridge doors, groceries that fly into the fridge after a saved expense, a shopping bag for new runs, a receipt book, a budget jar, a roommate noticeboard, and a repayment envelope.
- A full-screen room with transparent header and footer wrappers. The individual controls keep their cream surfaces, including when the camera focuses on an object.
- Object-focused camera transitions, drag-to-turn, wheel and pinch zoom, a whole-room framing control, day/evening lighting, and a kettle that responds to a tap. The phone view starts close enough to explore instead of shrinking the entire room into a thumbnail.
- Finance tools open beside the room on desktop and above the action dock on phones. The camera keeps the selected object in the visible area while the scene continues behind the UI. Keyboard-accessible controls provide alternatives to direct object picking.
- Receipt rows include the payer and expandable per-person shares. Camera transitions finish before idle animation pauses behind a panel, keeping forms responsive without losing the room.
- Reduced-motion support and a clear WebGL fallback that keeps the complete shared ledger usable.
- Automatically simplified repayment suggestions, confirmation when recording an actual payment, and reversal of incorrect records. **Roomlings does not move money or connect to a bank.**
- CSV export of the entire ledger, including recorded repayments.

The default currency is EUR. USD, GBP and RON are also supported. A household's currency cannot change once expenses exist. Editing the monthly budget changes the comparison target for all months.

## Persistence and sharing

The API stores data in `data/kitchen.sqlite`. Browser local storage holds random session tokens and kitchen names, never the full ledger. Previously visited kitchens can be reopened as the same roommate from **The roommates**. Treat invitation links and session tokens as credentials. All household members can add and remove expenses, record repayments, change house rules and rotate invitations. Rotating an invitation stops new joins through the old link; it does not remove existing members.

The project was originally called Coldshare. The folder rename preserves the existing SQLite database. On the same browser origin, existing `coldshare.session` and `coldshare.kitchens` values are read if the new `roomlings.*` keys are absent. A successful restoration saves the session under the new keys without deleting the old values. Changing the hostname or port changes the browser origin and does not carry browser sessions over automatically.

The app is designed for a small group of trusted roommates, not public anonymous hosting. There is no bank integration, email recovery, individual member removal or per-member permissions. Losing a browser session requires joining through an invitation as a new member. Existing ledger identities are never silently reassigned. Back up the SQLite database and keep the original browser session for ongoing use.

The development servers bind to loopback. A localhost invitation only works on the same computer. For sharing between devices, build and run the server behind an HTTPS reverse proxy on a host everyone can access:

```sh
npm run build
npm start
```

The production server serves both the built app and its API on port 4311. Put HTTPS and access controls on your reverse proxy. Use that site's origin when copying invitations. Do not expose the development server publicly. There is no CORS-enabled cross-origin API.

Copy `.env.example` to `.env` to change `PORT`, `HOST` or `DATA_DIR`. The Vite proxy targets port 4311; update `vite.config.ts` if changing the development API port. Node's built-in SQLite module may print an experimental warning on some supported Node versions.

## Feature review workflow

Work on one feature per local `feat/...` branch. Present a working local preview and explain the change before asking for approval to publish. Until that approval, do not push the branch or open a pull request. Approval to publish is not approval to merge.

Commit messages are short imperative sentences, with no body paragraphs or trailers. Commits and pull request descriptions have no attribution watermarks. Do not use em dashes in authored copy.

The GitHub workflow runs the existing domain, API, persistence, browser, and production-build commands for pull requests and updates to `main`. More contributor conventions are in [AGENTS.md](AGENTS.md).

Browser interactions run as focused scenarios with fresh contexts. CI retains action, DOM and network traces plus a screenshot on failure, without continuously recording the software-rendered 3D canvas.

## Interaction references

The peripheral controls draw on [Apple's ornament placement guidance](https://developer.apple.com/design/human-interface-guidelines/ornaments), adapted as a web layout pattern rather than a native visionOS component. The object-selection and inspector relationship also takes inspiration from [Tiny Room Planner](https://github.com/crayonzgrim/3d-room-planner). The kitchen's low-poly art and procedural models remain its own.
