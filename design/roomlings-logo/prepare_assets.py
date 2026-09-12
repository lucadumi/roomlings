"""Build the approved 2D Patchwork logo and outlined Baloo 2 wordmark."""

import argparse
import json
import shutil
from pathlib import Path
from xml.etree import ElementTree

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parent
INK = "#3d405b"
PAPER = "#fcf9f1"
WEIGHT = 650
TRACKING = -0.025


def instantiate(source, destination, axes):
    font = TTFont(source)
    available = {axis.axisTag for axis in font["fvar"].axes}
    if not set(axes).issubset(available):
        raise ValueError(f"Missing requested font axes in {source}")
    font = instantiateVariableFont(font, axes, inplace=False)
    font.flavor = None
    font.save(destination)
    return TTFont(destination)


def pair_kerning(font, left, right):
    if "GPOS" not in font:
        return 0
    table = font["GPOS"].table
    indices = sorted({
        index
        for feature in table.FeatureList.FeatureRecord
        if feature.FeatureTag == "kern"
        for index in feature.Feature.LookupListIndex
    })
    adjustment = 0
    for index in indices:
        lookup = table.LookupList.Lookup[index]
        if lookup.LookupType != 2:
            raise ValueError("The wordmark source needs a supported pair-positioning lookup.")
        for subtable in lookup.SubTable:
            if left not in subtable.Coverage.glyphs:
                continue
            if subtable.ValueFormat1 != 4 or subtable.ValueFormat2 != 0:
                raise ValueError("The wordmark kerning must contain horizontal advances only.")
            value = None
            if subtable.Format == 1:
                pair_set = subtable.PairSet[subtable.Coverage.glyphs.index(left)]
                pair = next((pair for pair in pair_set.PairValueRecord if pair.SecondGlyph == right), None)
                if pair is None:
                    continue
                value = pair.Value1
            elif subtable.Format == 2:
                first = subtable.ClassDef1.classDefs.get(left, 0)
                second = subtable.ClassDef2.classDefs.get(right, 0)
                value = subtable.Class1Record[first].Class2Record[second].Value1
            else:
                raise ValueError("Unsupported pair-positioning format in the wordmark source.")
            adjustment += value.XAdvance if value else 0
            break
    return adjustment


def svg_document(width, height, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{height:g}" '
        f'viewBox="0 0 {width:g} {height:g}" role="img" aria-label="Roomlings">\n'
        f'<title>Roomlings</title>\n{body}\n</svg>\n'
    )


def wordmark_group(metadata, color):
    paths = "\n".join(
        f'<path transform="translate({letter["x"]:g} 0)" d="{letter["path"]}"/>'
        for letter in metadata["letters"]
    )
    return f'<g fill="{color}">{paths}</g>'


def prepare(repository):
    fonts = ROOT / "fonts"
    exports = ROOT / "exports"
    fonts.mkdir(exist_ok=True)
    exports.mkdir(exist_ok=True)
    baloo = repository / "node_modules/@fontsource-variable/baloo-2"
    dm_sans = repository / "node_modules/@fontsource-variable/dm-sans"
    font = instantiate(
        baloo / "files/baloo-2-latin-wght-normal.woff2",
        fonts / "Roomlings-Baloo-2.ttf",
        {"wght": WEIGHT},
    )
    instantiate(
        dm_sans / "files/dm-sans-latin-standard-normal.woff2",
        fonts / "Roomlings-DM-Sans.ttf",
        {"wght": 500, "opsz": 14},
    )
    shutil.copyfile(baloo / "LICENSE", fonts / "Baloo-2-OFL.txt")
    shutil.copyfile(dm_sans / "LICENSE", fonts / "DM-Sans-OFL.txt")

    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    letters = []
    bounds = []
    x = 0
    previous = None
    for character in "roomlings":
        glyph_name = cmap[ord(character)]
        if previous is not None:
            x += pair_kerning(font, previous, glyph_name)
        path_pen = SVGPathPen(glyphs)
        glyphs[glyph_name].draw(path_pen)
        bounds_pen = BoundsPen(glyphs)
        glyphs[glyph_name].draw(bounds_pen)
        left, bottom, right, top = bounds_pen.bounds
        letters.append({"character": character, "x": x, "path": path_pen.getCommands()})
        bounds.append((x + left, bottom, x + right, top))
        x += font["hmtx"][glyph_name][0] + TRACKING * upm
        previous = glyph_name

    metadata = {
        "illustration": "Patchwork home",
        "font": {"family": "Baloo 2", "weight": WEIGHT, "trackingEm": TRACKING},
        "upm": upm,
        "letters": letters,
        "bounds": [
            min(b[0] for b in bounds), min(b[1] for b in bounds),
            max(b[2] for b in bounds), max(b[3] for b in bounds),
        ],
        "palette": {
            "paper": PAPER, "ink": INK, "deepSage": "#527861",
            "sage": "#81b29a", "tomato": "#e07a5f", "honey": "#f2cc8f",
        },
        "loader": "static",
    }
    left, bottom, right, top = metadata["bounds"]
    pad = 24
    width, height = right - left + pad * 2, top - bottom + pad * 2
    metadata["dimensions"] = {"icon": {"width": 256, "height": 256}, "wordmark": {"width": width, "height": height}}
    for name, color in [("wordmark", INK), ("wordmark-light", PAPER)]:
        body = (
            f'<g transform="translate({pad - left:g} {pad + top:g}) scale(1 -1)">'
            f'{wordmark_group(metadata, color)}</g>'
        )
        (exports / f"roomlings-{name}.svg").write_text(svg_document(width, height, body))

    flat = (ROOT / "source/icon-flat.svg").read_text()
    mono = (ROOT / "source/icon-mono.svg").read_text()
    if ElementTree.fromstring(flat).attrib.get("viewBox") != "0 0 256 256":
        raise ValueError("The approved Patchwork mark must retain its original viewBox.")
    for name, source in [("icon-flat", flat), ("icon-mono", mono), ("icon-light", mono.replace(INK, PAPER))]:
        (exports / f"roomlings-{name}.svg").write_text(source)

    icon_root = ElementTree.fromstring(flat)
    inner = flat[flat.index(">", flat.index("<svg")) + 1:flat.rindex("</svg>")].replace("  <title>Roomlings</title>", "")
    scale = 256 / (1.45 * height)
    baseline = (256 - height * scale) / 2 + (pad + top) * scale
    type_x = 256 + 0.18 * 256 / 1.45
    lockup = inner + (
        f'<g transform="translate({type_x + (pad - left) * scale:g} {baseline:g}) '
        f'scale({scale:g} {-scale:g})">{wordmark_group(metadata, INK)}</g>'
    )
    if icon_root.find("{http://www.w3.org/2000/svg}g") is None:
        raise ValueError("The approved icon source is missing its painted group.")
    (exports / "roomlings-lockup-flat.svg").write_text(
        svg_document(type_x + width * scale, 256, lockup)
    )
    (ROOT / "geometry.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Prepared Patchwork SVGs and the Baloo 2 wordmark ({width:g} by {height:g}).")


def install(repository):
    assets = repository / "src/assets/brand"
    assets.mkdir(parents=True, exist_ok=True)
    for name in ("roomlings-icon-flat.svg", "roomlings-icon-light.svg", "roomlings-wordmark.svg"):
        shutil.copyfile(ROOT / "exports" / name, assets / name)
    shutil.copyfile(ROOT / "exports/roomlings-icon-flat.svg", repository / "public/favicon.svg")
    dimensions = json.loads((ROOT / "geometry.json").read_text())["dimensions"]
    (assets / "dimensions.ts").write_text(
        "// Generated by design/roomlings-logo/prepare_assets.py.\n"
        f'export const brandDimensions = {json.dumps(dimensions, indent=2)} as const\n'
    )
    print("Installed the 2D app icon, wordmark, intrinsic dimensions and favicon.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "install"))
    parser.add_argument("--repository", type=Path, default=ROOT.parents[1])
    args = parser.parse_args()
    repository = args.repository.resolve()
    if args.stage == "prepare":
        prepare(repository)
    else:
        install(repository)
