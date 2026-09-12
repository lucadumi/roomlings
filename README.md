# Roomlings

Shared chores, shopping, bills and repayments in an interactive 3D home. Roomlings records payments; it never moves money.

## What it does

- Plan grocery runs with a shared list and individual shopping baskets.
- Assign one-off or recurring chores across the kitchen, bathroom, living room and whole home.
- Split paid groceries and recurring bills between the people sharing them.
- Track the monthly grocery budget and record roommate repayments.
- Share a household through verified-email accounts, invitations and saved access.
- Customize all three rooms with optional appliances, furniture and decorations across compatible, live-previewed positions.
- Keep rooms clear with zone filters, placement limits and reversible object storage.
- Give room admins editing access while everyone uses the same supplies, chores and manually recorded object states.

The room's objects open these tools, and a toolbar keeps them available without 3D. **Room objects** groups each kind into one preview card, with position choices for repeated objects. Its **Edit room** action lets admins preview and apply a shared layout. Installing or moving an object never creates a purchase, debt or chore. Every balance comes from the same shared ledger.

The object library includes kitchen appliances, shared-care tools and decorative pieces such as a stand mixer, fruit bowl, wall-mounted spice rack, tea set and board game. Retired extras are no longer offered for new placements; existing saved objects and their linked history remain editable. **Rooms** opens a compact preview menu directly beneath its button.

Zone limits affect new placements, not whether an existing home can open. Stored
objects retain their settings and history while linked care and supply shortcuts
pause. New households start with essential bathroom objects; older homes keep
their saved rooms.

The living room includes a corner sofa, coffee table, wall-mounted TV above a media unit with two compact, sharp-edged speakers, bookshelf, reading lamp, rug and curtained window, without a default garbage bin. The kitchen has matching back and left-wall windows with the same landscape view, plus a slim extractor hood over the hob. All three rooms share the same chores, shopping list and ledger. Existing saved layouts gain the living room without resetting their furniture or browser access.

Matte material textures, soft reflected lighting and naturally rounded edges soften the
existing room models without changing their layouts or proportions. Front-wall
entry doors follow the room cutaways. The interface retains its original sage,
honey and clay theme, independently of room colors.
View navigation moves only the camera; room geometry keeps its authored transform.

The flat Patchwork logo uses outlined Baloo 2 lettering. Baloo 2 also carries
headings and display text, while DM Sans remains the body and control font.
Request and scene loading states use a static Patchwork icon; branding has no 3D
variant. Object thumbnails and room-selector renders use the same reduced-motion-aware spinner.

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
| `/rooms/kitchen`, `/rooms/bathroom`, `/rooms/living-room` | Personal rooms and sign-in |

Email sign-in needs [Supabase setup](docs/accounts.md). Existing real browser access and recovery remain supported. Public room previews do not create households or anonymous sessions.

## Development

TypeScript, React and Three.js power the client. Express serves the API, with SQLite by default and optional Postgres storage. All rooms share household access, chores, shopping and financial history.

`src/surfaceMaterials.ts` shares deterministic, DOM-free room textures and releases
them when their last material owner is disposed. Use its material/clone helpers
for textured room surfaces, and keep physical finish roles separate from palette
color bindings. Surface preparation changes texture coordinates, not model shapes.
`src/roomGeometry.ts` controls bounded bevels and circular detail while preserving
dimensions and crisp thin details. Static batches index identical vertices without
merging distinct normals or texture coordinates.
`src/roomEnvironment.ts` owns each renderer's reusable reflection map. Preview
rendering yields between offscreen images, and material warmup does not leave
uncancellable shader polling behind when a room unmounts.

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
