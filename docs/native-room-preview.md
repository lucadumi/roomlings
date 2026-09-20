# Standalone kitchen preview

`KitchenPreview` is a named export from `src/KitchenWorld.tsx` for hosts that need the existing kitchen renderer without household tools. The separate Swift app bundles it with the same web dependencies, materials, models, lighting, shadows and camera logic.

Pass `roomStyle`, `paused`, optional room `components`, and `onStatus`. Status is `loading`, `ready` after the first draw, or `unavailable` after renderer initialization or context failure.

`wholeRoomView` defaults to `true`, preserving the fitted overview. Native hosts can pass `false` to use the game's closer entry view, with `roomZoom` as a positive base scale for their measured viewport. The iOS app pulls portrait back to about 0.6 at 402 by 874 points and uses 1 in landscape. Larger iPad windows render the room larger without a separate device rule.

The zoom readout compares the actual visible camera span with the default room view for the current layout. It starts at 100%, changes during object focus and manual zoom, and returns to 100% on reset. The fitted overview remains the baseline for whole-room previews; focusing does not change the manual zoom limits.

The preview keeps the camera controls, fridge, kettle and lighting interactions. Optional `onComponentSelect` enables installed objects' chore markers and reports their component IDs to the host. Without it, household picking stays disabled. There are no fake household callbacks or saved financial records.

The host owns the viewport and safe-area insets. iOS keeps the room background full-screen. In landscape, `cameraToolsInQuickActions` leaves only zoom in, the percentage and zoom out in the vertical right rail. Labels, reset and lighting sit beside the kettle at the household dock's level. Portrait and other callers keep the existing combined rail.

Ambient motion pauses when the scene becomes inactive, while a requested focus finishes before pausing. Rendering errors must remain visible with a recovery action.

Build the preview from the same source revision as the corresponding web graphics. It is not a native remake or a fork of the scene models. The mobile build records the source commit and dependency-lock hash in its bundled metadata.
