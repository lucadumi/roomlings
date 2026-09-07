# Working on Roomlings

## Product and design

Roomlings is a game-like shared-living app, not a dashboard with a decorative 3D model. Preserve the existing interactive kitchen and build on it incrementally.

- Keep the warm cream, sage and tomato palette, flat-shaded low-poly models, and object-driven interactions.
- Consult the owner before UI, UX, branding or logo design decisions. Present options and wait for a choice.
- Every visible action must work. Do not leave unfinished features or placeholder controls in the app.
- The shared ledger is the source of truth. Rooms and objects visualize it; they must not calculate separate, contradictory debts.
- The mobile app will be a separate project. Do not add a mobile scaffold to this web repository without a specific request.

## Branches, commits and approval

1. Work on one feature per local `feat/...` branch, based on the agreed baseline.
2. Provide a working local preview and a clear description of the feature.
3. Wait for explicit approval before any push, pull request creation or other remote change. A feature request or repository URL is not publication approval.
4. Open a pull request only after publication is approved. Wait for separate approval before merging.

Commit messages must be a short imperative sentence with no body or trailers. Do not add coauthor trailers, generated-with text or other attribution watermarks to commits or pull request descriptions. Do not use em dashes in authored text.

Do not rewrite history or discard unrelated changes. Keep the owner's existing kitchen data and browser sessions intact.

## Code and data

- Use TypeScript, React and Three.js for the client, and the existing Express and SQLite server.
- Keep money in integer cents. Reuse the splitting and settlement helpers in `shared/domain.ts`.
- Validate API inputs with the existing Zod schemas. Keep optimistic version checks for ledger mutations.
- Do not silently swallow failed saves or show a successful state when a request fails.
- Keep database files, browser session tokens, credentials, build output and test artifacts out of commits.
- Browser storage reads retain compatibility with the original Coldshare keys. Do not remove that compatibility without a migration plan.
- Fit landing-page cameras to measured CSS scene areas, not separate device breakpoints. Preserve coverage for longer copy, orientation changes and constrained viewports.
- Batch static opaque siblings with `batchStaticMeshes`, keeping interactive group boundaries intact. Add individually animated or visibility-controlled meshes to its preserved set.
- Invalidate cached shadows when a caster moves or changes visibility. Camera-only motion reuses the shadow map; gentle ambient leaf movement refreshes at 4 Hz.

## Existing commands

Run commands from the repository root.

```sh
npm run dev
npm test
npm run build
npm run test:browser
```

Use the smallest relevant existing test selection while iterating. Cover the changed behavior and preserve the existing household, settlement, persistence and accessibility flows before presenting a feature for approval.

Tag browser rendering and 3D interaction scenarios with `@room`. CI runs household flows separately from two room shards, each with one worker. Room tests must remain independent so `--fully-parallel` can partition them safely; the normal browser command still runs every test.
