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

New visitors see the landing at `/`. `/welcome` always shows the public page without API calls or changes to browser storage. `/kitchen` opens existing access or a private sample.

Sign in to create a household or link an existing roommate identity. Use `/#recover` for browser-only recovery. Legacy `coldshare.*` storage remains supported. Expired browser-only access can return through a valid signed-in account, without deleting its old shortcuts; server outages do not silently switch households.

The short tour supports native scrolling, keyboard navigation, reduced motion and an illustrated fallback. Its home illustration is conceptual; the kitchen is the currently interactive room.

## Development notes

Use http://localhost:5173 for review, preserving its data and browser sessions. `PLAYWRIGHT_BASE_URL` targets an already-running isolated test server; stop temporary servers when finished. Tag rendering and 3D-interaction browser scenarios with `@room` and keep them independent for CI sharding.

Visual references: [The Modern House](https://www.themodernhouse.com), [Splitwise](https://www.splitwise.com) and [Partiful](https://partiful.com). Roomlings uses its own artwork and local fonts.
