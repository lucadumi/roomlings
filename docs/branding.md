# Roomlings branding

The **Patchwork home** icon represents different pieces comfortably sharing one
home. The logo is entirely 2D, with lowercase **Baloo 2** lettering. Use the supplied
SVGs rather than redrawing the mark or replacing the outlined wordmark with text.

![Approved Roomlings icon, wordmark and compact variants](images/roomlings-identity.png)

## App components

`src/Branding.tsx` owns the shared components and imports the small production asset
set from `src/assets/brand`.

| Component | Use |
|---|---|
| `Brand` | Flat Patchwork icon with the outlined Baloo 2 wordmark |
| `Brand variant="featured"` | The same 2D artwork in the landing header; no image-type breakpoint |
| `Brand decorative` | Artwork inside a link that already has its own accessible name |
| `LoadingIcon` | Static, decorative Patchwork icon within an existing loading status or control |
| `LoadingIcon tone="light"` | The light monochrome mark on filled primary buttons |
| `LoadingIcon reducedMotion` | The same static mark; retained for existing motion-aware callers |
| `SceneLoading` | Shared, eagerly imported Suspense fallback with the existing status text |

Keep logo link destinations and accessible names. Reserve image dimensions and
preserve the artwork's aspect ratio and clear space. Intrinsic dimensions are
generated with the SVGs in `src/assets/brand/dimensions.ts`. The favicon is an exact
copy of the color Patchwork icon. There is no 3D logo, PNG fallback or WebGL renderer
for branding.

## Typography

Baloo 2 Variable is used at weight 600 for the existing heading and display-text
roles: page and dialog titles, selected landing headings, room names, large
summary amounts and decorative notes. DM Sans Variable remains the body and
interface font, including buttons, forms, dropdowns and detailed financial rows.
The logo lettering is separately outlined at weight 650 with `-0.025em` tracking.

Baloo 2 uses its native upright forms. Do not synthesize an italic version or keep
the previous font's variation axes. Both interface families are bundled locally
through Fontsource.

## Static 2D loader

The owner chose the static Patchwork icon for loading states. It has no animation,
timer, 3D treatment or alternate reduced-motion asset. The color and light icons
are reused directly, so there are no duplicate loader files. Do not apply `.spin`,
add a pulse or turn the mark into a progress meter.

Object-card image rendering uses a separate circular spinner while its render is
pending, not a rotating Patchwork mark. That spinner stops when the image or an
error is available and stays still for reduced motion.

Render the loader only while the existing operation is pending. Remove it when
the operation finishes or fails, without waiting for the animation loop to finish.
Keep existing errors, retries, disabled controls and loading messages. Announce
the message in the existing status element; the artwork itself is decorative.

## Source designs and regeneration

The editable [color icon](../design/roomlings-logo/source/icon-flat.svg),
[single-ink icon](../design/roomlings-logo/source/icon-mono.svg), glyph data,
generation scripts and [design handoff](../design/roomlings-logo/DESIGN-HANDOFF.md)
live under `design/roomlings-logo`. The old 3D logo and animated-threshold sources
have been retired.

Font licenses accompany the design sources. Generated fonts and presentation
exports stay out of Git; runtime SVGs, their dimensions and the approved reference
image above are retained. No Python or design-rendering dependency is needed by
the app itself.

## Saved plant illustrations

The tree-and-flowers PNG in `src/assets/garden/` decorates the closing invitation
letter. It is a static, lazy-loaded illustration, not a background or a WebGL
scene. The other illustration and both GLB assets remain available for future
use. Each composition has a transparent 600 by 1000 PNG and a reusable GLB with
flat normals, named parts and materials.

| Composition | Illustration | 3D asset |
|---|---|---|
| Tree and flowers | [left.png](../src/assets/garden/left.png) | [left.glb](../src/assets/garden/left.glb) |
| Leafy plant and flowers | [right.png](../src/assets/garden/right.png) | [right.glb](../src/assets/garden/right.glb) |
