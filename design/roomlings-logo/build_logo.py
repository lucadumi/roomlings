"""Build the editable Roomlings logo, its studio, and a native 3D lockup."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "geometry.json").read_text())
OUTLINE = DATA["outline"]
PALETTE = DATA["palette"]


def linear_channel(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def material(name, color, roughness=0.82):
    rgb = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
    rgba = tuple(linear_channel(channel) for channel in rgb) + (1,)
    result = bpy.data.materials.new(name)
    result.diffuse_color = rgba
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = rgba
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Specular IOR Level"].default_value = 0.22
    return result


def bevel(object_, width):
    modifier = object_.modifiers.new("Small flat-shaded edge chamfers", "BEVEL")
    modifier.width = width
    modifier.segments = 1
    modifier.affect = "EDGES"
    modifier.harden_normals = True
    modifier.profile = 0.5
    normal = object_.modifiers.new("Keep broad wall faces planar", "WEIGHTED_NORMAL")
    normal.keep_sharp = True
    normal.weight = 50


def box(collection, name, center, size, materials, interior_face=None, edge=0.025):
    x, y, z = center
    dx, dy, dz = [value / 2 for value in size]
    vertices = [
        (x - dx, y - dy, z - dz), (x + dx, y - dy, z - dz),
        (x + dx, y + dy, z - dz), (x - dx, y + dy, z - dz),
        (x - dx, y - dy, z + dz), (x + dx, y - dy, z + dz),
        (x + dx, y + dy, z + dz), (x - dx, y + dy, z + dz),
    ]
    faces = [
        (0, 3, 2, 1), (0, 1, 5, 4), (1, 2, 6, 5),
        (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    object_ = bpy.data.objects.new(name, mesh)
    collection.objects.link(object_)
    for value in materials:
        mesh.materials.append(value)
    if interior_face is not None:
        mesh.polygons[interior_face].material_index = 1
    if edge:
        bevel(object_, edge)
    return object_


def build_mark(collection, sage, cream, tomato):
    count = len(OUTLINE)
    front_y, back_y = -0.44, 0.19
    vertices = [(x, y, z) for y in (front_y, back_y) for x, z in OUTLINE]
    faces = [
        tuple(range(count)),
        tuple(range(count * 2 - 1, count - 1, -1)),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, index + count, following + count, following))
    mesh = bpy.data.meshes.new("r / continuous architectural silhouette")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(sage)
    mesh.materials.append(cream)
    mesh.polygons[1].material_index = 1
    for edge in range(1, 7):
        mesh.polygons[edge + 2].material_index = 1
    facade = bpy.data.objects.new("01 / Sage r with cream doorway reveal", mesh)
    collection.objects.link(facade)
    facade["design"] = "A room wall becomes a lowercase r. The open counter is the doorway."

    returning_wall = box(
        collection, "02 / Returning wall, cream inside",
        (-0.826, 0.405, 1.215), (0.228, 0.51, 2.23),
        [sage, cream], interior_face=2, edge=0,
    )
    join = facade.modifiers.new("Join the two walls without overlapping faces", "BOOLEAN")
    join.operation = "UNION"
    join.solver = "EXACT"
    join.object = returning_wall
    bpy.context.view_layer.objects.active = facade
    bpy.ops.object.modifier_apply(modifier=join.name)
    bpy.data.objects.remove(returning_wall, do_unlink=True)
    bevel(facade, 0.043)
    threshold = box(
        collection, "02 / Tomato threshold",
        (0.19, -0.075, 0.17), (0.86, 0.57, 0.14),
        [tomato], edge=0.024,
    )
    threshold["design"] = "One warm welcome at floor level, without specifying a room."
    return [facade, threshold]


def configure_scene(scene, samples, resolution, transparent=False):
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = transparent
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.35
    scene.view_settings.gamma = 1
    world = bpy.data.worlds.new(f"{scene.name} / warm studio")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.82, 0.82, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    scene.world = world
    scene.unit_settings.system = "NONE"


def area_light(collection, name, position, target, power, size, color):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = power
    light.shape = "DISK"
    light.size = size
    light.color = color
    object_ = bpy.data.objects.new(name, light)
    collection.objects.link(object_)
    object_.location = position
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()
    return object_


def light_studio(scene):
    rig = bpy.data.collections.new(f"{scene.name} / lighting")
    scene.collection.children.link(rig)
    area_light(rig, "Key / broad warm window", (-3.8, -4.5, 7), (0, 0, 1.3), 420, 4.5, (1, 0.98, 0.94))
    area_light(rig, "Fill / soft cream bounce", (4.5, -2, 4.2), (0, 0, 1.2), 160, 4, (0.95, 0.98, 1))
    area_light(rig, "Top / edge separation", (0.7, 4, 6), (0, 0, 1.4), 300, 3.5, (1, 0.98, 0.95))


def camera(scene, name, position, target, scale):
    data = bpy.data.cameras.new(name)
    data.type = "ORTHO"
    data.ortho_scale = scale
    data.lens = 60
    data.clip_end = 200
    object_ = bpy.data.objects.new(name, data)
    scene.collection.objects.link(object_)
    object_.location = position
    object_.rotation_euler = (Vector(target) - object_.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = object_
    return object_


def build_lockup(source_objects, ink, samples):
    scene = bpy.data.scenes.new("02 / Icon and editable wordmark")
    configure_scene(scene, samples, (2400, 760), transparent=True)
    objects = bpy.data.collections.new("Lockup / linked icon")
    scene.collection.children.link(objects)
    root = bpy.data.objects.new("Icon placement", None)
    objects.objects.link(root)
    root.location = (-4.06, 0, 0.23)
    root.rotation_euler = (math.radians(12), 0, math.radians(-22))
    for original in source_objects:
        copy = original.copy()
        copy.data = original.data
        copy.parent = root
        objects.objects.link(copy)

    letters = bpy.data.collections.new("Wordmark / editable Fraunces letters")
    scene.collection.children.link(letters)
    font = bpy.data.fonts.load(str(ROOT / "fonts/Roomlings-Fraunces.ttf"))
    left, bottom, right, top = DATA["bounds"]
    size = 6.9 / ((right - left) / DATA["upm"])
    letter_objects = []
    for index, letter in enumerate(DATA["letters"]):
        curve = bpy.data.curves.new(f"Wordmark / {index + 1} / {letter['character']}", "FONT")
        curve.body = letter["character"]
        curve.font = font
        curve.size = size
        curve.extrude = 0.009
        curve.bevel_depth = 0.0018
        curve.bevel_resolution = 1
        curve.resolution_u = 12
        curve.materials.append(ink)
        object_ = bpy.data.objects.new(curve.name, curve)
        letters.objects.link(object_)
        object_.rotation_euler = (math.pi / 2, 0, 0)
        object_.location = (
            -2.43 + (letter["x"] - left) / DATA["upm"] * size,
            -0.45,
            1.02,
        )
        letter_objects.append(object_)
    bpy.context.window.scene = scene
    bpy.context.view_layer.update()
    first = letter_objects[0]
    bounds = DATA["letters"][0]["bounds"]
    expected_width = (bounds[2] - bounds[0]) / DATA["upm"] * size
    actual_width = max(v[0] for v in first.bound_box) - min(v[0] for v in first.bound_box) - 2 * first.data.bevel_depth
    # Blender normalizes font height differently from SVG's units-per-em.
    em_correction = expected_width / actual_width
    for object_ in letter_objects:
        object_.data.size *= em_correction
    camera(scene, "Lockup / straight-on orthographic", (0, -14, 1.58), (0, 0, 1.58), 11)
    light_studio(scene)
    return scene


def render(scene, path):
    scene.render.filepath = str(path)
    bpy.context.window.scene = scene
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=128)
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--render", choices=("all", "icon", "lockup", "none"), default="all")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    renders = ROOT / "renders"
    renders.mkdir(exist_ok=True)
    exports = ROOT / "exports"
    exports.mkdir(exist_ok=True)

    sage = material("Sage / matte painted outer walls", PALETTE["sage"])
    cream = material("Cream / warm plaster reveals", PALETTE["cream"])
    tomato = material("Tomato / terracotta threshold", PALETTE["tomato"], 0.90)
    ink = material("Ink / Roomlings wordmark", PALETTE["ink"])
    paper = material("Paper / studio floor", PALETTE["paper"], 1)

    scene = bpy.context.scene
    scene.name = "01 / Room-built r"
    configure_scene(scene, args.samples, (1100, 1100) if args.draft else (1800, 1800))
    model = bpy.data.collections.new("Logo / editable walls and threshold")
    scene.collection.children.link(model)
    objects = build_mark(model, sage, cream, tomato)
    stage = bpy.data.collections.new("Studio / excluded from icon exports")
    scene.collection.children.link(stage)
    ground = box(stage, "Matte paper floor", (0, 0, 0.05), (200, 200, 0.1), [paper], edge=0)
    camera(scene, "Icon / orthographic three-quarter", (4.3, -8.5, 5.2), (0.02, 0, 1.36), 3.55)
    light_studio(scene)
    lockup = build_lockup(objects, ink, args.samples)

    if args.render in ("all", "icon"):
        render(scene, renders / "icon-studio.png")
        ground.hide_render = True
        scene.render.film_transparent = True
        render(scene, renders / "icon-transparent.png")
        ground.hide_render = False
        scene.render.film_transparent = False
    if args.render in ("all", "lockup"):
        render(lockup, renders / "lockup-native-3d.png")

    bpy.context.window.scene = scene
    bpy.ops.object.select_all(action="DESELECT")
    for object_ in objects:
        object_.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(exports / "roomlings-icon.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_yup=True,
        export_materials="EXPORT",
    )
    scene["design_direction"] = "Room-built r, approved concept A. Not specific to a kitchen."
    scene["palette"] = "Cream #efe3c8 / Sage #71846b / Tomato #c75338 / Ink #343c32"
    scene["wordmark"] = "Fraunces 650, optical size 48, softness 45, wonk 1. SIL OFL."
    guide = bpy.data.texts.new("START HERE")
    guide.use_fake_user = True
    guide.write(
        "ROOMLINGS / ROOM-BUILT r\n\n"
        "Scene 01: editable architectural icon and a soft, orthographic studio.\n"
        "Scene 02: the icon paired with nine editable, lightly extruded letters.\n\n"
        "The sage facade joins a perpendicular return wall. Cream plaster lines\n"
        "the opening; the tomato threshold suggests coming home, not one room.\n"
        "The bevels are deliberately single-segment and the broad faces stay flat.\n\n"
        "The Fraunces typeface is packed into this file. Its SIL Open Font License\n"
        "is included in fonts/Fraunces-OFL.txt beside this file.\n\n"
        "exports/ holds transparent PNGs, outlined SVGs and the PBR icon GLB.\n"
        "Use the flat icon at small sizes and the SVG wordmark for crisp UI text.\n"
        "renders/roomlings-logo-board.png shows the proposed identity together.\n"
        "See ../../docs/branding.md for the app components and usage rules.\n"
    )
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_perspective = "CAMERA"
                area.spaces.active.shading.type = "SOLID"
                area.spaces.active.shading.color_type = "MATERIAL"
    bpy.ops.file.pack_all()
    for font in bpy.data.fonts:
        if font.packed_file is not None:
            font.filepath = f"//fonts/{Path(font.filepath).name}"
    scene.render.filepath = "//renders/icon-studio.png"
    lockup.render.filepath = "//renders/lockup-native-3d.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "roomlings-logo.blend"))
    print("Saved the native Blender source, icon GLB and studio renders.")


if __name__ == "__main__":
    main()
