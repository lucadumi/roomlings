# Using Roomlings

## Kitchen tools

| Object | Purpose |
| --- | --- |
| Shopping bag | Add and claim items, then record the paid receipt. Checking off items creates no debt. |
| Receipt book | Browse groceries; create, edit or pause recurring bills. Record a bill only after payment. |
| House pot | See the remaining monthly grocery budget. Bills do not reduce this pot. |
| Envelope | Record or undo repayments. All balances come from the shared ledger. |
| Noticeboard | Manage roommates, invitations, account access and saved kitchens. |
| Room style | Apply Original, Sage, Clay or Linen for everyone. |

The fridge visualizes purchases, not food remaining. Export the complete ledger from the receipt book.

Bills use the creator's time zone. Edits preserve earlier months and paid occurrences; resuming a paused bill does not backfill missed months. Short months use their last day.

## Entry and access

`/` is always the public home page; `/welcome` is an alias. Neither reads account access or creates a session. Sign-in opens `/rooms/kitchen`; successful sign-in or household creation enters the room directly. The room's wordmark returns home.

`/sample/kitchen` opens a private sample without signing in. Its access key is separate from personal and Coldshare sessions; sample edits never change your real household. A definitively expired sample can restart with an explicit notice, while outages retain the existing sample for retry.

Sign in to create a household or link an existing roommate identity. Old `/kitchen`, invitation and `/#recover` links remain supported, including `coldshare.*` storage. Expired browser-only access can return through a valid signed-in account without deleting old shortcuts. Genuinely expired or revoked accounts require a new email code, then reopen saved data rather than replacing it with a demo.

The short tour supports native scrolling, keyboard navigation, reduced motion and an illustrated fallback. Its home illustration is conceptual; the kitchen is the currently interactive room.

## Development notes

Use http://localhost:5173 for review, preserving its data and browser sessions. `PLAYWRIGHT_BASE_URL` targets an already-running isolated test server; stop temporary servers when finished. Tag rendering and 3D-interaction browser scenarios with `@room` and keep them independent for CI sharding.

Room IDs and routes are registered in `src/roomNavigation.ts`; every ID must have a renderer in `src/roomViews.ts`. Add implemented rooms there instead of adding placeholder links or new authentication flows. Rooms share the existing household ledger and account access.

Visual references: [The Modern House](https://www.themodernhouse.com), [Splitwise](https://www.splitwise.com) and [Partiful](https://partiful.com). Roomlings uses its own artwork and local fonts.
