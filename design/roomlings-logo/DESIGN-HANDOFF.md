# Roomlings logo and loader

The approved directions are the **room-built r** logo and the **threshold pulse**
loader. Their app components and production assets are documented in
[the branding guide](../../docs/branding.md). New design directions and placements
outside existing branding/loading positions still require owner approval.

**The logo has a 3D treatment. The loader is 2D only**, with flat colors and no
perspective, shading or 3D runtime.

Open `preview.html` after generating the design exports for the logo board, moving
loader and static alternatives. The standalone preview needs no server or account.
Generated exports are ignored by Git; the app assets, editable Blender source and
approved reference images are retained in the repository.

## Design

The icon is a lowercase r made from a sage wall, a perpendicular return wall and
a cream doorway reveal. A small tomato threshold suggests arriving home.
There is no furniture, appliance or roof, so it is not tied to the kitchen.

Keep the flat shading, single-segment chamfers, orthographic view and matte surfaces.
Do not turn the mark into a glossy inflated letter, add room furniture or replace it
with a generic house icon.

| Role | Color |
|---|---|
| Paper background | `#f8f7f2` |
| Sage outer walls | `#71846b` |
| Cream inner reveal | `#efe3c8` |
| Tomato threshold | `#c75338` |
| Wordmark ink | `#343c32` |

The lowercase wordmark uses Fraunces at weight 650, optical size 48, softness 45 and
wonk 1, with adjusted spacing. **Use the supplied outlined SVG**, not a browser font
approximation. The editable letters and packed font are also in the Blender source.
Font licenses are in `fonts/`.

## Files to use

| Need | File |
|---|---|
| Editable logo and 3D wordmark | `roomlings-logo.blend` |
| Logo presentation | `renders/roomlings-logo-board.png` |
| Standalone interactive 3D icon | `exports/roomlings-icon.glb` |
| Transparent 3D icon | `exports/roomlings-icon-3d.png` |
| 3D icon paired with a crisp wordmark | `exports/roomlings-lockup-3d.png` |
| Vector icon and wordmark together | `exports/roomlings-lockup-flat.svg` |
| Standalone wordmark | `exports/roomlings-wordmark.svg` |
| Light wordmark for dark backgrounds | `exports/roomlings-wordmark-light.svg` |
| Small-size icon | `exports/roomlings-icon-flat.svg` |
| One-color icon | `exports/roomlings-icon-mono.svg` |
| Light one-color icon | `exports/roomlings-icon-light.svg` |
| Editable 2D loader, primary motion reference | `loader/roomlings-loader.svg` |
| Light monochrome loader for filled buttons | `loader/roomlings-loader-light.svg` |
| Transparent 2D animated reference | `loader/roomlings-loader.webp` |
| 2D animated reference on cream | `loader/roomlings-loader.gif` |
| Static 2D loader | `loader/roomlings-loader-still.png` |
| Motion keyframes | `loader/motion-keyframes.png` |
| Machine-readable timing | `loader/motion.json` |

The transparent lockup pairs a rendered icon with flat lettering. The second Blender
scene also contains a fully 3D, lightly extruded wordmark for uses that need it.
These are deliberately separate treatments.

Use the flat icon at 16-48 px. Use the 3D render where there is enough space to see
the doorway. Preserve aspect ratios and the built-in clear space. Do not stretch,
crop, independently recolor the faces or redraw the wordmark.

## Loader motion

This is a **2D, indeterminate** loader. It must not imply a percentage or completion.
The sage r stays still. Only the tomato threshold moves. Do not use the 3D logo
render or GLB as the loader.

| Property | Specification |
|---|---|
| Loop | 2,000 ms, repeating seamlessly |
| Reference sampling | 30 fps, 60 frames |
| Rest | 0 ms and 2,000 ms |
| Peak | 1,000 ms |
| Vertical lift | 8 SVG units in the 128-unit viewBox, 1.5 px when displayed at 24 px |
| Easing per half | `cubic-bezier(.37, 0, .63, 1)` |
| Rotation, scale and opacity | Unchanged |
| Reduced motion | Static mark with the threshold at rest |

The SVG has keys at 0%, 50% and 100%. Animated image exports sample 60 frames
without duplicating the starting frame at the end.

Filled primary buttons use the approved light monochrome mark with the same motion,
so both the r and its moving threshold remain visible against tomato.

When implementing later, respect `prefers-reduced-motion`. The animated SVG already
does. For animated image implementations, explicitly choose the static alternative
when reduced motion is requested.

Keep any loading announcement in the application's existing accessible status
element. Treat the artwork as decorative there, so the screen reader does not
announce both the logo and a duplicate loading message. Do not use animation to
hide failures or replace the application's error and retry states.

## Notes for another AI

Use this kit as the visual and motion reference. The existing branding and loading
positions are approved. Do not infer permission to change layouts, onboarding,
navigation or the app's current loading behavior.

Prefer the outlined SVGs and provided image assets for normal UI use. Do not add a
WebGL renderer solely to display a small logo. The icon GLB is available for places
that already render 3D content. The loader must stay 2D.

The logo's Blender file contains a `START HERE` text block and remains editable.
`build_logo.py` reproduces the geometry. `prepare_assets.py` prepares the licensed
typeface outlines, writes the animated 2D SVG and composes image exports.
`build_loader.mjs` captures frames directly from that SVG using the existing
Playwright installation. It accepts `--repository /path/to/the/app-checkout`.
The Python scripts use Blender's Python API plus FontTools, Brotli and Pillow.
None of these scripts changes the web app's dependencies.

Run the generation steps from the repository root with those tools available:

```sh
python3 design/roomlings-logo/prepare_assets.py prepare --repository .
blender --background --python design/roomlings-logo/build_logo.py
python3 design/roomlings-logo/prepare_assets.py compose
node design/roomlings-logo/build_loader.mjs --repository .
python3 design/roomlings-logo/prepare_assets.py loader
python3 design/roomlings-logo/prepare_assets.py install
```

On macOS, the Blender executable may be at
`/Applications/Blender.app/Contents/MacOS/Blender`. The install step updates only the
production brand assets, favicon and documentation images. Blender and the Python
generation tools are not required to run or build the web app.
