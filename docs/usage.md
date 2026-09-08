# Using Roomlings

## Shared rooms and tools

Open **Rooms** and choose a kitchen or bathroom preview card without changing your household or session. Both rooms start at the same close-up scale; **Whole room** zooms out to show the full space. The toolbar remains available in both rooms, including when 3D cannot load.

| Object | Purpose |
| --- | --- |
| Shopping bag | Add and claim items, then record the paid receipt. Checking off items creates no debt. |
| Receipt book | Browse groceries; create, edit or pause recurring bills. Record a bill only after payment. |
| House pot | See the remaining monthly grocery budget. Bills do not reduce this pot. |
| Envelope | Record or undo repayments. All balances come from the shared ledger. |
| Noticeboard | Manage roommates, invitations, account access and saved kitchens. |
| Room style | Apply Original, Sage, Clay or Linen for everyone. |
| Chores | View this room, the whole home or all rooms; assign tasks and record completed turns. |
| Supply shelf | Add low supplies to the existing shopping list, without inventing an inventory. |

The fridge visualizes purchases, not food remaining. Export the complete ledger from the receipt book.

Form dropdowns use the same cream and sage styling throughout. Open one to choose an option, use arrow keys or type to find a choice, and press Escape to close just the menu without losing the form.

## Chores and restocking

Add a chore with a room or whole-home scope, an optional area, a due date and a one-off or recurring schedule. One assigned person keeps the task; multiple people rotate in the chosen order. The next turn advances only after a saved completion. Any active roommate can do the task, and history records who actually completed it.

Dates use the household time zone. Late recurring completions advance to the next future scheduled date, without creating fake missed completions. Former roommates are skipped in rotations; if no active assignee remains, the task is unassigned until edited.

History retains the original task title, room and scheduled date. Undo restores the previous scheduled turn only if there has been no later edit or completion. Archived tasks keep their history and can be restored.

Bathroom fixtures open their related chores; the cleaning caddy opens the room's list. The kitchen has the same chore controls alongside its existing finance tools. Restocking pre-fills a shopping item for review and avoids adding a supply already on the active list. It never records a paid expense.

Bills use the creator's time zone. Edits preserve earlier months and paid occurrences; resuming a paused bill does not backfill missed months. Short months use their last day.

## Shared changes and retries

Roommates see the same saved household. If a shopping item, chore, monthly bill or house rule changes while you edit it, the form keeps your draft and asks you to use the latest values or explicitly keep your draft. Bill payment forms also require review when the unpaid schedule changes.

An interrupted response does not mean the server rejected a save. Retrying the same change confirms an already-saved result without adding another expense, bill, chore, shopping item or repayment. If you changed the draft after an earlier save succeeded, review the saved record before starting a new change. Shopping checkouts retain their own run identifier and purchased-item history.

Repayments can combine balances from multiple expenses and months. Their limits follow the actual outstanding balances, not the maximum size of an individual grocery receipt. The app still records money already paid; it never transfers money.

Household name changes refresh saved browser shortcuts. Account refreshes update saved profile and browser names without replacing unfinished drafts, and remove kitchens whose membership has ended. Conflicted membership actions refresh their settings before you confirm or retry them.

## Entry and access

`/` is always the public home page; `/welcome` is an alias. Neither reads account access or creates a session. Sign-in opens `/rooms/kitchen`; successful sign-in or household creation enters the room directly. The room's wordmark returns home.

`/sample/kitchen` or `/sample/bathroom` opens a private sample home without signing in. Both rooms reuse its sample access key, separate from personal and Coldshare sessions; sample edits never change your real household. A definitively expired sample can restart with an explicit notice, while outages retain the existing sample for retry.

Sign in to create a household or link an existing roommate identity. Old `/kitchen`, invitation and `/#recover` links remain supported, including `coldshare.*` storage. Expired browser-only access can return through a valid signed-in account without deleting old shortcuts. Genuinely expired or revoked accounts require a new email code, then reopen saved data rather than replacing it with a demo.

The short kitchen tour supports native scrolling, keyboard navigation, reduced motion and an illustrated fallback. The hero is a conceptual home illustration, not an exact floor plan.

The landing page's **Explore the rooms** section offers kitchen and bathroom previews. Choose a room with the preview cards or arrow keys, then use its sample link. Kitchen chapters retain their guided tour; the bathroom preview opens the same private sample household in that room. Previewing reads no household access and does not create a sample until you open it. Existing chapter links remain supported, and `/#tour-bathroom` opens the bathroom preview directly.

## Development notes

Use http://localhost:5173 for review, preserving its data and browser sessions. `PLAYWRIGHT_BASE_URL` targets an already-running isolated test server; stop temporary servers when finished. Tag rendering and 3D-interaction browser scenarios with `@room` and keep them independent for CI sharding.

Room IDs, chore areas and restocking suggestions are registered in `shared/rooms.ts`; `src/roomNavigation.ts` resolves routes and every room needs a renderer in `src/roomViews.ts` and a preview in `src/RoomPicker.tsx`. Add implemented rooms there instead of adding placeholder links or new authentication flows. All rooms share household data and version-checked API mutations; chores never change financial balances.

Use `src/Dropdown.tsx` for form selects. It preserves raw values, including empty whole-home and one-off choices, while Radix handles menu positioning, keyboard navigation and touch interaction.

Version-checked household mutations accept a stable `mutationId` and its original `mutationVersion`. The latest 1,000 mutation receipts persist with household JSON, independently of financial records. Replays return the current household without repeating a saved change; changed payloads or requests older than retained confirmation history require explicit review. Older clients without mutation metadata remain compatible. Do not regenerate a mutation identifier merely because a response was lost or a background refresh advanced the household version.

Visual references: [The Modern House](https://www.themodernhouse.com), [Splitwise](https://www.splitwise.com) and [Partiful](https://partiful.com). Roomlings uses its own artwork and the original Fraunces and DM Sans interface fonts. The outlined logo lettering is independent of interface fonts.
