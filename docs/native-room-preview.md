# Standalone kitchen preview

`KitchenPreview` is a named export from `src/KitchenWorld.tsx` for hosts that need the existing kitchen renderer without household tools. The separate Swift app bundles it with the same web dependencies, materials, models, lighting, shadows and camera logic.

Pass `roomStyle`, `paused`, optional room `components`, and `onStatus`. Status is `loading`, `ready` after the first draw, or `unavailable` after renderer initialization or context failure.

The preview keeps the camera controls, fridge, kettle and lighting interactions. Household picking targets and object chore markers are not exposed, and there are no fake household callbacks or saved financial records. Ordinary `KitchenWorld` callers retain their existing behavior.

The host owns its viewport and can pause ambient motion when its scene becomes inactive. It must keep rendering errors visible and provide recovery rather than claiming that an unavailable scene is ready.

Build the preview from the same source revision as the corresponding web graphics. It is not a native remake or a fork of the scene models. The mobile build records the source commit and dependency-lock hash in its bundled metadata.
