"""Prepare licensed type outlines, then compose the rendered logo presentation."""

import argparse
import json
import shutil
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
PAPER = "#f8f7f2"
INK = "#343c32"
SAGE = "#71846b"
TOMATO = "#c75338"
CREAM = "#efe3c8"
PALE = "#e8eddf"

# The front elevation is shared by the Blender mesh and the small-size mark.
OUTLINE = [
    [-0.94, 0.10], [-0.31, 0.10], [-0.31, 1.61],
    [-0.21, 1.82], [-0.02, 1.97], [0.23, 2.03],
    [0.48, 1.98], [0.65, 1.85], [0.97, 2.38],
    [0.71, 2.56], [0.38, 2.65], [0.055, 2.63],
    [-0.18, 2.52], [-0.31, 2.38], [-0.31, 2.60],
    [-0.94, 2.60],
]


def instantiate(source, destination, axes):
    font = TTFont(source)
    available = {axis.axisTag for axis in font["fvar"].axes}
    if not set(axes).issubset(available):
        raise ValueError(f"Missing requested font axes in {source}")
    font = instantiateVariableFont(font, axes, inplace=False)
    font.flavor = None
    font.save(destination)
    return TTFont(destination)


def prepare(repository):
    fonts = ROOT / "fonts"
    exports = ROOT / "exports"
    fonts.mkdir(exist_ok=True)
    exports.mkdir(exist_ok=True)
    fraunces = repository / "node_modules/@fontsource-variable/fraunces"
    dm_sans = repository / "node_modules/@fontsource-variable/dm-sans"
    font = instantiate(
        fraunces / "files/fraunces-latin-full-normal.woff2",
        fonts / "Roomlings-Fraunces.ttf",
        {"wght": 650, "opsz": 48, "SOFT": 45, "WONK": 1},
    )
    instantiate(
        dm_sans / "files/dm-sans-latin-standard-normal.woff2",
        fonts / "Roomlings-DM-Sans.ttf",
        {"wght": 500, "opsz": 14},
    )
    shutil.copyfile(fraunces / "LICENSE", fonts / "Fraunces-OFL.txt")
    shutil.copyfile(dm_sans / "LICENSE", fonts / "DM-Sans-OFL.txt")

    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    x = 0
    letters = []
    bounds = []
    for character in "roomlings":
        glyph_name = cmap[ord(character)]
        path_pen = SVGPathPen(glyphs)
        glyphs[glyph_name].draw(path_pen)
        bounds_pen = BoundsPen(glyphs)
        glyphs[glyph_name].draw(bounds_pen)
        left, bottom, right, top = bounds_pen.bounds
        bounds.append((x + left, bottom, x + right, top))
        letters.append({
            "character": character,
            "x": x,
            "bounds": [left, bottom, right, top],
            "path": path_pen.getCommands(),
        })
        x += font["hmtx"][glyph_name][0] - 20

    metadata = {
        "upm": upm,
        "letters": letters,
        "bounds": [
            min(b[0] for b in bounds), min(b[1] for b in bounds),
            max(b[2] for b in bounds), max(b[3] for b in bounds),
        ],
        "outline": OUTLINE,
        "palette": {
            "paper": PAPER, "ink": INK, "sage": SAGE,
            "tomato": TOMATO, "cream": CREAM,
        },
    }
    (ROOT / "geometry.json").write_text(json.dumps(metadata, indent=2) + "\n")
    write_vectors(metadata)
    print("Prepared editable fonts, outlined wordmarks and flat companion marks.")


def wordmark_group(metadata, color):
    paths = "\n".join(
        f'<path transform="translate({letter["x"]} 0)" d="{letter["path"]}"/>'
        for letter in metadata["letters"]
    )
    return f'<g fill="{color}">{paths}</g>'


def svg_document(width, height, title, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.3f} {height:.3f}" '
        f'role="img" aria-labelledby="title">\n'
        f'<title id="title">{title}</title>\n{body}\n</svg>\n'
    )


def flat_icon_group(metadata, mono=False, color=None):
    points = [(28 + (x + 0.94) * 37, 111 - z * 37) for x, z in OUTLINE]
    path = "M" + " L".join(f"{x:.3f},{y:.3f}" for x, y in points) + " Z"
    wall = color or (INK if mono else SAGE)
    threshold = color or (INK if mono else TOMATO)
    return (
        f'<path fill="{wall}" d="{path}"/>\n'
        f'<rect x="57" y="102" width="31" height="5.3" rx="1.2" fill="{threshold}"/>'
    )


def write_vectors(metadata):
    exports = ROOT / "exports"
    left, bottom, right, top = metadata["bounds"]
    pad = 24
    width, height = right - left + pad * 2, top - bottom + pad * 2
    for name, color in [("wordmark", INK), ("wordmark-light", PAPER)]:
        body = (
            f'<g transform="translate({pad - left} {pad + top}) scale(1 -1)">'
            f'{wordmark_group(metadata, color)}</g>'
        )
        (exports / f"roomlings-{name}.svg").write_text(
            svg_document(width, height, "Roomlings", body)
        )
    for name, mono, color in [
        ("icon-flat", False, None),
        ("icon-mono", True, None),
        ("icon-light", True, PAPER),
    ]:
        (exports / f"roomlings-{name}.svg").write_text(
            svg_document(128, 128, "Roomlings", flat_icon_group(metadata, mono, color))
        )

    type_scale = 64 / (top - bottom)
    icon_size = 128
    type_x = 140
    type_height = (top - bottom) * type_scale
    baseline = (128 - type_height) / 2 + top * type_scale
    body = flat_icon_group(metadata) + (
        f'<g transform="translate({type_x - left * type_scale} {baseline}) '
        f'scale({type_scale} {-type_scale})">{wordmark_group(metadata, INK)}</g>'
    )
    (exports / "roomlings-lockup-flat.svg").write_text(
        svg_document(type_x + (right - left) * type_scale + 12, icon_size, "Roomlings", body)
    )
    loader = ROOT / "loader"
    loader.mkdir(exist_ok=True)
    animation = (
        "<style>\n"
        ".threshold { animation: threshold-pulse 2s cubic-bezier(.37,0,.63,1) infinite; }\n"
        "@keyframes threshold-pulse {\n"
        "  0%, 100% { transform: translateY(0); }\n"
        "  50% { transform: translateY(-8px); }\n"
        "}\n"
        "@media (prefers-reduced-motion: reduce) { .threshold { animation: none; } }\n"
        "</style>\n"
    )
    for name, color in [("roomlings-loader", None), ("roomlings-loader-light", PAPER)]:
        body = flat_icon_group(metadata, color=color).replace("<rect ", '<rect class="threshold" ')
        (loader / f"{name}.svg").write_text(
            svg_document(128, 128, "Roomlings loading mark", animation + body)
        )


def wordmark_image(metadata, target_width, color=INK):
    left, bottom, right, top = metadata["bounds"]
    padding = 12
    scale = (target_width - padding * 2) / (right - left)
    size = max(1, round(metadata["upm"] * scale))
    font = ImageFont.truetype(str(ROOT / "fonts/Roomlings-Fraunces.ttf"), size)
    image = Image.new(
        "RGBA", (target_width, round((top - bottom) * scale) + padding * 2),
        (0, 0, 0, 0),
    )
    draw = ImageDraw.Draw(image)
    baseline = padding + top * scale
    for letter in metadata["letters"]:
        draw.text(
            (padding + (letter["x"] - left) * scale, baseline),
            letter["character"], font=font, fill=color, anchor="ls",
        )
    return image


def flat_icon_image(size, color=None):
    factor = 4
    image = Image.new("RGBA", (size * factor, size * factor))
    draw = ImageDraw.Draw(image)
    scale = size * factor / 128
    points = [
        ((28 + (x + 0.94) * 37) * scale, (111 - z * 37) * scale)
        for x, z in OUTLINE
    ]
    draw.polygon(points, fill=color or SAGE)
    draw.rounded_rectangle(
        (57 * scale, 102 * scale, 88 * scale, 107.3 * scale),
        radius=1.2 * scale, fill=color or TOMATO,
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def contain(image, size):
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def compose():
    metadata = json.loads((ROOT / "geometry.json").read_text())
    renders = ROOT / "renders"
    exports = ROOT / "exports"
    icon = Image.open(renders / "icon-transparent.png").convert("RGBA")
    content = icon.getbbox()
    if content is None:
        raise ValueError("The rendered 3D icon is empty.")
    icon = icon.crop(content)

    wordmark = wordmark_image(metadata, 2200)
    wordmark.save(exports / "roomlings-wordmark.png")
    wordmark_image(metadata, 2200, PAPER).save(exports / "roomlings-wordmark-light.png")
    icon_canvas = Image.new("RGBA", (1024, 1024))
    icon_fit = contain(icon, (880, 880))
    icon_canvas.alpha_composite(
        icon_fit, ((1024 - icon_fit.width) // 2, (1024 - icon_fit.height) // 2)
    )
    icon_canvas.save(exports / "roomlings-icon-3d.png")
    for size in (16, 24, 32, 48, 64, 128, 256, 512):
        flat_icon_image(size).save(exports / f"roomlings-icon-flat-{size}.png")

    lockup = Image.new("RGBA", (2400, 760))
    lockup_icon = contain(icon, (550, 600))
    lockup.alpha_composite(lockup_icon, (65, (760 - lockup_icon.height) // 2))
    lockup_type = wordmark_image(metadata, 1720)
    lockup.alpha_composite(
        lockup_type, (610, (760 - lockup_type.height) // 2 + 12)
    )
    lockup.save(exports / "roomlings-lockup-3d.png")

    board = Image.new("RGBA", (2400, 1780), PAPER)
    draw = ImageDraw.Draw(board)
    label_font = ImageFont.truetype(str(ROOT / "fonts/Roomlings-DM-Sans.ttf"), 25)
    small_font = ImageFont.truetype(str(ROOT / "fonts/Roomlings-DM-Sans.ttf"), 22)
    draw.text((110, 77), "ROOMLINGS / ROOM-BUILT r", font=label_font, fill=INK)
    draw.text((2290, 77), "3D icon + wordmark", font=label_font, fill="#69725e", anchor="ra")

    hero = contain(lockup, (2180, 800))
    board.alpha_composite(hero, ((2400 - hero.width) // 2, 270))
    draw.line((110, 1130, 2290, 1130), fill="#dedfd3", width=2)

    cards = [(110, 1220, 770, 1645), (870, 1220, 1530, 1645), (1630, 1220, 2290, 1645)]
    for index, (x0, y0, x1, y1) in enumerate(cards):
        draw.rounded_rectangle(
            (x0, y0, x1, y1), radius=24, fill=INK if index == 2 else PALE
        )
    small_icon = contain(icon, (270, 310))
    board.alpha_composite(
        small_icon, (440 - small_icon.width // 2, 1430 - small_icon.height // 2)
    )
    flat = flat_icon_image(320)
    board.alpha_composite(flat, (1040, 1250))
    inverse = wordmark_image(metadata, 540, PAPER)
    board.alpha_composite(inverse, (1690, 1430 - inverse.height // 2))

    for x, label in [(110, "01 / 3D icon"), (870, "02 / Flat companion"), (1630, "03 / Wordmark")]:
        draw.text((x, 1170), label, font=small_font, fill="#69725e")
    draw.text((110, 1710), "Cream / sage / tomato", font=small_font, fill="#69725e")
    for index, color in enumerate((CREAM, SAGE, TOMATO)):
        x = 2180 + index * 45
        draw.ellipse((x, 1705, x + 28, 1733), fill=color)
    board.convert("RGB").save(renders / "roomlings-logo-board.png")

    sizes = Image.new("RGB", (1100, 260), PAPER)
    sizes_draw = ImageDraw.Draw(sizes)
    for x, size in zip((70, 220, 380, 560, 760), (16, 24, 32, 64, 128)):
        sample = flat_icon_image(size)
        sizes.paste(sample, (x, 80), sample)
        sizes_draw.text((x, 220), f"{size}px", font=small_font, fill=INK)
    sizes.save(renders / "small-size-sheet.png")
    print("Composed the presentation, transparent lockup and small-size exports.")


def compose_loader():
    loader = ROOT / "loader"
    paths = sorted((loader / "frames").glob("threshold-*.png"))
    if len(paths) != 60:
        raise ValueError(f"Expected 60 loader frames, found {len(paths)}.")
    frames = [Image.open(path).convert("RGBA") for path in paths]
    if any(frame.size != (512, 512) for frame in frames):
        raise ValueError("Every loader frame must be 512 by 512.")
    frames[0].save(loader / "roomlings-loader-still.png")
    frames[0].save(
        loader / "roomlings-loader.webp",
        save_all=True, append_images=frames[1:],
        duration=[33, 33, 34] * 20, loop=0, lossless=True, method=6,
    )

    opaque = []
    for frame in frames:
        image = Image.new("RGBA", frame.size, PAPER)
        image.alpha_composite(frame)
        opaque.append(image.convert("RGB"))
    swatches = Image.new("RGB", (384, 384), PAPER)
    for index, frame in enumerate(opaque[::7][:9]):
        swatches.paste(frame.resize((128, 128)), ((index % 3) * 128, (index // 3) * 128))
    palette = swatches.quantize(colors=256)
    gif_frames = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in opaque]
    gif_frames[0].save(
        loader / "roomlings-loader.gif",
        save_all=True, append_images=gif_frames[1:],
        duration=[30, 30, 40] * 20, loop=0, disposal=2, optimize=False,
    )

    sheet = Image.new("RGB", (1680, 530), PAPER)
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype(str(ROOT / "fonts/Roomlings-DM-Sans.ttf"), 22)
    for index, (frame, label) in enumerate([
        (opaque[0], "0 ms / rest"),
        (opaque[15], "500 ms / lifting"),
        (opaque[30], "1000 ms / peak"),
        (opaque[45], "1500 ms / settling"),
    ]):
        sheet.paste(frame.resize((380, 380), Image.Resampling.LANCZOS), (20 + index * 420, 35))
        draw.text((50 + index * 420, 460), label, font=font, fill=INK)
    sheet.save(loader / "motion-keyframes.png")
    print("Saved the transparent animated WebP, GIF fallback and motion keyframes.")


def install_runtime_assets():
    repository = ROOT.parents[1]
    assets = repository / "src/assets/brand"
    illustrations = repository / "docs/images"
    assets.mkdir(parents=True, exist_ok=True)
    illustrations.mkdir(parents=True, exist_ok=True)
    for name in ("roomlings-icon-flat.svg", "roomlings-icon-light.svg", "roomlings-wordmark.svg"):
        shutil.copyfile(ROOT / "exports" / name, assets / name)
    for name in ("roomlings-loader.svg", "roomlings-loader-light.svg"):
        shutil.copyfile(ROOT / "loader" / name, assets / name)
    image = Image.open(ROOT / "exports/roomlings-icon-3d.png")
    image.resize((512, 512), Image.Resampling.LANCZOS).save(assets / "roomlings-icon-3d.png", optimize=True)
    shutil.copyfile(ROOT / "exports/roomlings-icon-flat.svg", repository / "public/favicon.svg")
    shutil.copyfile(ROOT / "renders/roomlings-logo-board.png", illustrations / "roomlings-identity.png")
    shutil.copyfile(ROOT / "loader/motion-keyframes.png", illustrations / "roomlings-loader-frames.png")
    print("Installed the app assets, favicon and approved design references.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "compose", "loader", "install"))
    parser.add_argument("--repository", type=Path)
    args = parser.parse_args()
    if args.stage == "prepare":
        if args.repository is None:
            parser.error("--repository is required when preparing fonts")
        prepare(args.repository.resolve())
    elif args.stage == "compose":
        compose()
    elif args.stage == "loader":
        compose_loader()
    else:
        install_runtime_assets()
