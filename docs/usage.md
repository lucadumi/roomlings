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
| Room style | Admins choose shared room colors. Individual objects can match the room or use their own finish. |
| Room objects | Browse installed objects, restock their supplies, set up care and record manual states. |
| Edit room | Admins preview installed objects and their configuration, then apply the changes for everyone. |
| Chores | View this room, the whole home or all rooms; assign tasks and record completed turns. |
| Supply shelf | Add low supplies to the existing shopping list, without inventing an inventory. |

The fridge visualizes purchases, not food remaining. Export the complete ledger from the receipt book.

The softer Garden pop palette uses warm cream, gentle leafy greens and muted tomato, sunflower and sky-blue accents across the interface, rooms, object finishes and previews. Linen remains the quieter neutral room option. Saved household data and individual finish selections are unchanged.

Panels, forms and cards carry the toolbar's accent colors: tomato for shopping and people, sky blue for receipts and repayments, sunflower for the house pot, and leafy green for chores and room objects.

Large low-poly plants sit behind the landing page's outer edges without changing the content grid. Soft clear areas keep the text readable and leave its dotted background intact. Scrolling gives the leaves a gentle gust that settles back into a breeze. The existing **Reduced motion** control pauses both movements. Reduced-motion preferences and unavailable 3D use matching still artwork; very narrow gutters leave the decoration out rather than cropping it.

Form dropdowns use the same cream and sage styling throughout. Open one to choose an option, use arrow keys or type to find a choice, and press Escape to close just the menu without losing the form.

## Customizing a room

Open the icon-only **Room objects** button, then choose **Edit room** inside its menu. The existing room-style, help and house-rule controls remain available. The object browser is a large preview grid on the left, with the room beside it. Hover over a preview or focus its controls for details. Repeated objects share one card: Plant opens its placed positions instead of appearing twice in the menu.

Select an object in the room or its card. Position buttons choose which existing copy you are using or editing. In Edit room, **Position** moves that copy between compatible locations, and **Add at another position** creates another private-preview placement. The room updates live as you choose; nothing is shared before Apply. Occupied or incompatible positions are disabled. These are designed locations, not unrestricted dragging.

The catalog includes fitted appliances; coffee and cooking equipment; fruit bowls, tea sets, spice racks and storage jars; carts, cabinets, speakers, plants and pet bowls; and bathroom accessories such as scales, a hair dryer, toothbrush holders and a bath tray. The original kitchen and bathroom remain the defaults. Adding an object does not add supplies to shopping, schedule chores, record a purchase or change a balance.

Change an object's name, finish, supported model and supply suggestions. **Match room colors** uses the household palette, without an extra default-style label. Model controls appear only when there is a real choice, such as a rectangular or round table, bath or shower, different plants, or different coffee machines. Supplies have editable names and suggested quantities, not stock counts.

Changes in the editor are a private preview until **Apply for everyone** succeeds. Cancel leaves the saved room unchanged. A failed save keeps the draft, and a conflicting edit requires review before retrying. Changing a manual state while an admin is editing cannot be silently overwritten by an older configuration draft.

The catalog marks **Available to add**, **Placed**, and **Unavailable**, with availability filters above the grid. Available includes objects with another free position, even if one copy is already placed. An unsaved addition is **In preview**, not placed. Some positions need a compatible fixture: remove a placed bath tray before changing its bathtub to a shower. An object removed only in your draft is available in that preview, not yet removed from the shared home.

Some fitted fixtures and the existing household tools stay in place, but their appearance and relevant options can still be customized. Moving an optional object within its room keeps its identity, manual state, supplies and chore links. Removing it also keeps its saved identity and settings, but connected chores must be archived or kept as room chores. Shopping items, paid receipts and completed turns are never deleted by removal. Restore the object before restoring its archived object-specific chores.

Use **Household admins** from the roommate tools or the editor to see who can manage the rooms. An admin can grant or revoke another roommate's admin access, but cannot demote the owner. Ownership transfer and the existing owner-only account powers remain separate. All active roommates can use the objects, shared shopping and chores without editing the room.

## Object supplies, care and states

**Room objects** uses the same preview grid and works with or without 3D. Its thumbnails use the actual object models, a consistent camera, soft grounding and the room's lighting. One shared renderer creates cached previews rather than opening a WebGL context per card; vector previews remain available without WebGL. Optional appliances also open their details when selected in the room; the original fridge, kettle and household shortcuts retain their familiar interactions. From an object's details, review supplies, open its chores or use a suggested chore as a starting point for a schedule and rotation.

The **Components** page is marked **Live room** for everyday use of placed objects. **Edit room** is marked **Private preview** for adding, removing and changing appearance. These are separate workflows: everyday supplies, chores and manual states use the shared home, while layout edits require Apply or Cancel.

Supply shortcuts use the existing shared list. If an item is already listed, review that quantity instead of adding another copy. Restocking from an object records its source; when the same supply serves multiple objects, an existing quantity or shopper's claim is not overwritten. Source names remain with purchased-item history and in the ledger export, even if an object is later renamed or removed.

An appliance state is a roommate's manual update, not a sensor reading. Marking a dishwasher **Running** or **Ready to empty** does not start a real appliance, consume supplies, finish a chore, start a timer or record a payment. Objects without meaningful operational states do not get artificial status controls. Record completed chores separately so their assignments and history remain accurate.

## Chores and restocking

Add a chore with a room or whole-home scope, an optional area or installed object, a due date and a one-off or recurring schedule. One assigned person keeps the task; multiple people rotate in the chosen order. The next turn advances only after a saved completion. Any active roommate can do the task, and history records who actually completed it.

Dates use the household time zone. Late recurring completions advance to the next future scheduled date, without creating fake missed completions. Former roommates are skipped in rotations; if no active assignee remains, the task is unassigned until edited.

History retains the original task title, room, object name where applicable, and scheduled date. Undo restores the previous scheduled turn only if there has been no later edit or completion. Archived tasks keep their history and can be restored when their object is installed.

Bathroom fixtures open their related chores; the cleaning caddy opens the room's list. The kitchen has the same chore controls alongside its existing finance tools. Restocking pre-fills a shopping item for review and avoids adding a supply already on the active list. It never records a paid expense.

Bills use the creator's time zone. Edits preserve earlier months and paid occurrences; resuming a paused bill does not backfill missed months. Short months use their last day.

## Shared changes and retries

Roommates see the same saved household. If an object, shopping item, chore, monthly bill or house rule changes while you edit it, the form keeps your draft and asks you to use the latest values or explicitly keep your draft. Bill payment forms also require review when the unpaid schedule changes.

An interrupted response does not mean the server rejected a save. Retrying the same change confirms an already-saved result without adding another expense, bill, chore, shopping item or repayment. If you changed the draft after an earlier save succeeded, review the saved record before starting a new change. Shopping checkouts retain their own run identifier and purchased-item history.

Repayments can combine balances from multiple expenses and months. Their limits follow the actual outstanding balances, not the maximum size of an individual grocery receipt. The app still records money already paid; it never transfers money.

Household name changes refresh saved browser shortcuts. Account refreshes update saved profile and browser names without replacing unfinished drafts, and remove kitchens whose membership has ended. Conflicted membership actions refresh their settings before you confirm or retry them.

## Entry and access

`/` is always the public home page; `/welcome` is an alias. Neither reads account access or creates a session. Sign-in opens `/rooms/kitchen`; successful sign-in or household creation enters the room directly. The room's wordmark returns home.

Room access belongs to a real household. Public previews never create households or anonymous sessions; sign in to create or join a home, or restore an existing real browser identity.

Sign in to create a household or link an existing roommate identity. Old `/kitchen`, invitation and `/#recover` links remain supported, including `coldshare.*` storage. Expired browser-only access can return through a valid signed-in account without deleting old shortcuts. Genuinely expired or revoked accounts require a new email code, then reopen the original saved data.

The short kitchen tour supports native scrolling, keyboard navigation, reduced motion and an illustrated fallback. The hero is a conceptual home illustration, not an exact floor plan.

The landing page's **Explore the rooms** section uses one shared template for the kitchen and bathroom. Choose a room with the preview cards or arrow keys, then scroll through its objects or use the chapter controls. Previewing reads no household access and creates no data. Use the page's Sign in or Get started actions when you want to enter a real household. Existing kitchen chapter links remain supported, and `/#tour-bathroom` opens the bathroom exploration directly.

Both rooms support selecting their 3D objects, with chapter or fixture buttons as a keyboard alternative. They use the same overview scale and camera angle throughout their scroll tours. A 2D loading indicator stays visible until the renderer is ready; an illustrated fallback keeps the controls available if 3D cannot load. Reduced motion keeps the room stationary while its descriptions remain navigable. The closing invitation retains one direct Start sharing CTA.

## Development notes

Use http://localhost:5173 for review, preserving its data and browser sessions. `PLAYWRIGHT_BASE_URL` targets an already-running isolated test server; stop temporary servers when finished. Tag rendering and 3D-interaction browser scenarios with `@room` and keep them independent for CI sharding.

Room IDs and legacy chore areas are registered in `shared/rooms.ts`. The component catalog, fixed positions, supported variants, manual states and default supply/chore suggestions live in `shared/roomComponents.ts`; configuration and state rules live in `shared/componentChanges.ts`. `src/roomNavigation.ts` resolves routes and every room needs a renderer in `src/roomViews.ts` and a preview in `src/RoomPicker.tsx`. Add implemented rooms and components instead of placeholder links or new authentication flows. All rooms share household data and version-checked API mutations; chores never change financial balances.

New households persist their original component layout. Older JSON without `roomComponents` resolves to deterministic original fixtures without rewriting the stored household or replacing browser sessions. The first saved component change materializes that layout. Component IDs survive removal, and historical shopping/chore references remain valid independently of the currently configured supply list.

Configuration updates use `PATCH /api/household/room-components` with a room ID, changed configurations and each object's reviewed version. The existing household version and mutation receipt protect the whole atomic update. `PATCH /api/room-components/:id/state` records an allowed manual state for an installed object. Only admins may change configuration or the shared room style; all active members may update a supported manual state. Household room previews use saved configuration; public landing previews stay curated and never read personal household data.

Use `src/Dropdown.tsx` for form selects. It preserves raw values, including empty whole-home and one-off choices, while Radix handles menu positioning, keyboard navigation and touch interaction.

Version-checked household mutations accept a stable `mutationId` and its original `mutationVersion`. The latest 1,000 mutation receipts persist with household JSON, independently of financial records. Replays return the current household without repeating a saved change; changed payloads or requests older than retained confirmation history require explicit review. Older clients without mutation metadata remain compatible. Do not regenerate a mutation identifier merely because a response was lost or a background refresh advanced the household version.

Visual references: [The Modern House](https://www.themodernhouse.com), [Splitwise](https://www.splitwise.com) and [Partiful](https://partiful.com). Roomlings uses its own artwork and the original Fraunces and DM Sans interface fonts. The outlined logo lettering is independent of interface fonts.
