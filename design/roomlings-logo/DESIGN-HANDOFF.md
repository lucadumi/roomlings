# Roomlings / Patchwork identity

The approved identity is the **flat Patchwork home illustration with lowercase
Baloo 2 lettering**. The loading mark is the same **static 2D icon**. There is no
3D logo, extrusion, animated threshold or separate desktop logo treatment.

The app uses Baloo 2 at weight 600 for its existing heading and display-text roles.
DM Sans remains the body, navigation, form and control font. The wordmark is
outlined SVG, independent of the interface fonts.

## Artwork

Keep the selected quilt contour, patch positions, colors and transparent margins.
The icon uses a 256 by 256 viewBox. Its single-ink adaptation has transparent seam
cutouts instead of a painted background.

| Role | Color |
|---|---|
| Deep sage patch | `#527861` |
| Sage patch | `#81b29a` |
| Tomato patch | `#e07a5f` |
| Honey patch | `#f2cc8f` |
| Wordmark and single ink | `#3d405b` |
| Light treatment | `#fcf9f1` |

The wordmark uses Baloo 2 at weight 650, native pair kerning and `-0.025em`
tracking. `prepare_assets.py` outlines the actual font glyphs rather than replacing
the wordmark with browser text. The combined logo matches the app's 1.45em icon
size and 0.18em gap.

## Editable and production files

| Need | File |
|---|---|
| Editable color icon | `source/icon-flat.svg` |
| Editable single-ink icon | `source/icon-mono.svg` |
| Wordmark glyphs and metrics | `geometry.json` |
| Outlined lettering | `exports/roomlings-wordmark.svg` |
| Light lettering | `exports/roomlings-wordmark-light.svg` |
| Combined vector logo | `exports/roomlings-lockup-flat.svg` |
| Color icon and loader | `exports/roomlings-icon-flat.svg` |
| Light icon and loader | `exports/roomlings-icon-light.svg` |
| Single-ink artwork | `exports/roomlings-icon-mono.svg` |
| Design board | `renders/roomlings-logo-board.png` |
| Offline preview | `preview.html` |

Runtime SVGs and their generated intrinsic dimensions live in
`src/assets/brand/`. The favicon is an exact copy of the color icon. Font licenses
are in `fonts/`; generated fonts, raster exports and preview output are ignored.

## Static loading mark

`LoadingIcon` uses the color icon on light surfaces and the light icon on filled
buttons. It stays still with either motion preference. Existing callers may keep
passing `reducedMotion`, but there is no alternate motion asset.

Preserve the actual pending states, loading messages, disabled controls, errors
and retry behavior. The mark must disappear when the operation finishes or fails.
Do not add a cosmetic delay, spinning wrapper, progress percentage or WebGL scene.
The surrounding status element owns the announcement; the image is decorative.

## Regeneration

Run from the repository root after installing the existing app dependencies.
Asset generation uses Python FontTools with its Brotli WOFF2 decoder and the
existing Playwright installation. These tools are not required to run the app.

```sh
python3 design/roomlings-logo/prepare_assets.py prepare --repository .
python3 design/roomlings-logo/prepare_assets.py install --repository .
node design/roomlings-logo/build_previews.mjs
```

The install stage updates the app SVGs, generated dimensions and favicon. The
preview stage updates the 2D documentation image and small-size exports. No Blender
source or 3D branding asset is used.

New branding directions, loader motion or unrelated interface redesign still
require owner approval. Publishing and merging remain separate approvals.
