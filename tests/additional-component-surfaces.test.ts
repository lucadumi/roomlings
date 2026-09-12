import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { createRoomComponent, roomSlots } from '../shared/roomComponents.ts'
import type { RoomComponent } from '../shared/roomComponents.ts'
import { buildAdditionalComponentModel } from '../src/additionalComponentModels.ts'
import type { AdditionalModelTools } from '../src/additionalComponentModels.ts'
import {
  createRoomMaterial, createRoomMaterialVariant, roomMaterialSurface, setRoomMaterialSurface,
} from '../src/surfaceMaterials.ts'
import type { RoomSurface } from '../src/surfaceMaterials.ts'
import { componentMaterialAppearance, componentMaterialColors } from '../src/componentMaterials.ts'
import { meshSurfaceMaterials } from './surface-fixture.ts'

const kinds = [
  'oven', 'blender', 'rice-cooker', 'fruit-bowl', 'spice-rack', 'bread-box', 'knife-block',
  'cookbook-stand', 'paper-towel-holder', 'storage-jars', 'kitchen-cart', 'pet-bowls',
  'speaker', 'air-purifier', 'watering-can', 'tea-set', 'bathroom-scales', 'hair-dryer',
  'toothbrush-holder', 'storage-cabinet', 'wall-calendar', 'key-hooks', 'bath-tray',
  'bathroom-stool', 'stand-mixer', 'waffle-maker', 'kitchen-scale', 'cutting-boards',
  'mug-tree', 'cereal-dispenser', 'egg-basket', 'wall-shelf', 'ironing-board',
  'toilet-brush', 'shower-squeegee', 'tissue-box', 'first-aid-kit', 'reed-diffuser',
  'board-game', 'record-player',
] as const satisfies readonly RoomComponent['kind'][]

type AdditionalKind = typeof kinds[number]

// Rounded construction: primitive arguments, buffers, transforms, natural colors and finish bindings.
const baselines: Record<AdditionalKind, string> = {
  oven: '023485acf0d405da2749a41b71e47cab89bf0acc63704a765ae79defdf6aa73e',
  blender: '52345b7305a5b7e7c6df172686b91b35310c87d673ed82c29188ed13568ee1c2',
  'rice-cooker': '7389359c91feeb56043a26ca6f68f51bc5d77373075c322c595f3bab59a5a412',
  'fruit-bowl': '15030944a2220e856add42d6b081140ff08511fd33805ebc8056e598a1de3ba6',
  'spice-rack': '00eed93a38b249a26e3142d478c7bd10f80bbd47c80bd012f8ea57cc5153a1a5',
  'bread-box': '6ca91329591b384c2a4d179062141377e38e020b95e80eb475e908c6ee4a6bc0',
  'knife-block': 'c2bd2fa85d003780e194c6d0eed72551275ca1495e7771dade0dd9f56449d3cc',
  'cookbook-stand': 'f4b64cd2334e738caec6a1738a49c858119272e478a8d35569a6ca17be6ab449',
  'paper-towel-holder': '097c36aaf6c4d118a329fc8e36be8ac6e83d0b1771d3d5d3189b89722b9a67a4',
  'storage-jars': 'e78b73a76e5e8258c854959360a963cd702cee7a14093d130540aa712c7439e6',
  'kitchen-cart': '26088dafa150fa7ed11752d0383202b7f13f9511b3d1aa53aa3b19293b298f13',
  'pet-bowls': 'ee638b3be4942f39b5059dcd07c8ddb1bb5131e8759689896d54b2b3f8404dab',
  speaker: '3f72552582e38f622f26567d5c8d5e3ea4a58268f259f51a456045ed0acdbf83',
  'air-purifier': '379ff3b5e81f1451254e96f9a0844c37684da8a6462326330f5e9e78c5a5a9d2',
  'watering-can': 'e14e95049cbaa549787a17a685ad39a6d307bb22d28a97132d95d79ad209c9ba',
  'tea-set': '75a50b0df80bceab4d4897d553b09fbd31504583058f5149ce28f7b7289ed5aa',
  'bathroom-scales': 'f5b29adf1a56d4e8220fa57cda4b21495af47a4964c7ad4e0083cbd68ac7c89b',
  'hair-dryer': 'e8b7bea076f3382fdac654b6d12708dc9f285f336c8499969b3a0de8f206d537',
  'toothbrush-holder': '45fa1ebde8831249f49e74551e63bb98b8cdae259063e331045f20d3710783f8',
  'storage-cabinet': '487076fd131abbad24db55236cdc9fd98fb6b726a4e44d32fbe3090d7cbfeca3',
  'wall-calendar': '15ccbe7dc9a6aced3249268f8887d824ea0e131c0e04f67c3d2b71fe0c229138',
  'key-hooks': '5d9afc46c57baf5adad8212b2b5be4f7db024bcc034865daacf17c362a93a288',
  'bath-tray': '0099f71c3bb1f0a24c2322a1b5094548d3bcbc2a444556b3a707796c6c87c797',
  'bathroom-stool': 'f3273d4d90ab9ad6db7f93fa21003dbaf654d8f66a14bfbe5c5e49386029a613',
  'stand-mixer': '89e6eacc295f770d4ce34e281dd9e29b5459f9a896e5132d98d3d9477c0cda92',
  'waffle-maker': 'e88945f54b9dded01672266d1d58c1d404b5eeb4a1a558d232548dbfbc843516',
  'kitchen-scale': '3cdc70e84ae83aaab65df2a5d60e3e227a8ab8d4a3ff95ff1a1b05fcf77d7d33',
  'cutting-boards': 'f06efd04e655429abcdf484f53435f3be21b174c4de568b414df653d8a54cb2c',
  'mug-tree': '0b8441d58244c45f72e0e232919dd2fe619932bd4b52487ab15875b5b38165eb',
  'cereal-dispenser': '9a136d1f29673f74e7d42c4cde1f3346ed9927e8b1ec072260d1940b91806460',
  'egg-basket': 'e0abc56b60ec3b84b171e73a4d4bb96ae36255c94f04d09b7376241683b13b36',
  'wall-shelf': '094ed16ab2b7d98803387e3ff0b85706a6945230bc7b8e152224f5b1b41aa8ee',
  'ironing-board': 'af84d54448386fe4ad85ed72c46f157181177b1710bb3f4da067e0ea7d070232',
  'toilet-brush': 'b0a786e0ccc329458568fe79ba0c9c382d6643bf584c4dad45e0933dbbd46bb9',
  'shower-squeegee': '38b2d3cb6127397ffc776eb3959c5aed2863f6250196f3ad8142fb264c176257',
  'tissue-box': 'c98fc491da956997b6111236508f37101ef8a6bfdd9543feb0bb3198b7bb0003',
  'first-aid-kit': '6990bbd85791df6300516ba42a90d3e942e44a5b2918a445667c2d8f2188e8a6',
  'reed-diffuser': '23a7f6284c6c8d798a687ac2cef9c2e6b174bf8094264bb62b16df1b43eb6704',
  'board-game': '2ae00c2e50941f438500e57859a0405b95f09a38484e5d8b2b32c17aa4a259cc',
  'record-player': '6a418f7c1f8c71e03cab23fa85f8c2844cab7e453f033f5157539713d50a8950',
}

function repeat(count: number, ...surfaces: RoomSurface[]): RoomSurface[] {
  return Array.from({ length: count }, () => surfaces).flat()
}

const expectedRoles: Record<AdditionalKind, RoomSurface[]> = {
  oven: [...repeat(4, 'rubber'), 'metal', 'metal', ...repeat(5, 'paint'), 'glass', ...repeat(3, 'metal')],
  blender: ['paint', ...repeat(3, 'metal'), 'clear-glass', 'paint', 'paint', 'metal'],
  'rice-cooker': [...repeat(5, 'paint'), 'glass', 'metal'],
  'fruit-bowl': [...repeat(2, 'ceramic'), ...repeat(4, 'food')],
  'spice-rack': [...repeat(7, 'wood'), ...repeat(4, 'clear-glass', 'paint'), 'wood', 'wood', ...repeat(3, 'clear-glass', 'paint')],
  'bread-box': [...repeat(4, 'wood'), 'paint', ...repeat(4, 'food'), ...repeat(4, 'wood'), 'paint'],
  'knife-block': ['wood', 'metal', 'rubber', 'metal', 'rubber', 'metal', 'metal', 'metal', 'rubber', 'metal', 'rubber'],
  'cookbook-stand': ['wood', 'wood', ...repeat(6, 'paper')],
  'paper-towel-holder': ['wood', 'wood', 'paper', 'wood'],
  'storage-jars': ['wood', ...repeat(3, 'clear-glass', 'food', 'ceramic', 'wood')],
  'kitchen-cart': [...repeat(4, 'metal'), 'wood', 'wood', 'metal', ...repeat(4, 'rubber')],
  'pet-bowls': ['rubber', 'metal', 'food', 'metal', 'glass'],
  speaker: ['paint', 'fabric', 'rubber', 'rubber'],
  'air-purifier': [...repeat(10, 'paint'), 'metal'],
  'watering-can': ['paint', 'paint', 'glass', 'paint', 'paint', 'paint'],
  'tea-set': ['wood', 'ceramic', 'ceramic', 'paint', 'ceramic', 'ceramic', ...repeat(2, 'ceramic', 'glass', 'ceramic')],
  'bathroom-scales': ['paint', 'metal', 'glass', ...repeat(4, 'metal')],
  'hair-dryer': [...repeat(4, 'paint'), 'metal'],
  'toothbrush-holder': ['ceramic', ...repeat(3, 'paint', 'fabric')],
  'storage-cabinet': [...repeat(4, 'rubber'), 'paint', 'wood', 'paint', 'paint', 'rubber', 'metal', 'metal'],
  'wall-calendar': ['wood', ...repeat(11, 'paper'), 'metal'],
  'key-hooks': ['wood', ...repeat(8, 'metal'), ...repeat(2, 'paint', 'metal')],
  'bath-tray': [...repeat(3, 'wood'), 'fabric', 'fabric', 'paper', 'paper'],
  'bathroom-stool': repeat(7, 'wood'),
  'stand-mixer': ['paint', 'metal', ...repeat(3, 'paint'), 'metal', 'metal', 'paint'],
  'waffle-maker': ['paint', ...repeat(10, 'metal'), 'paint', 'metal', 'rubber', 'glass'],
  'kitchen-scale': ['metal', 'glass', 'metal', 'metal'],
  'cutting-boards': repeat(7, 'wood'),
  'mug-tree': ['wood', 'wood', ...repeat(4, 'wood', 'ceramic', 'glass', 'ceramic')],
  'cereal-dispenser': ['wood', 'clear-glass', 'food', 'wood', 'paint'],
  'egg-basket': ['fabric', 'wood', 'wood', ...repeat(5, 'food')],
  'wall-shelf': [...repeat(4, 'wood'), ...repeat(5, 'paper')],
  'ironing-board': ['wood', 'fabric', 'wood', 'fabric', ...repeat(3, 'metal'), 'rubber', 'rubber', 'paint', 'paint', 'metal', 'paint'],
  'toilet-brush': ['ceramic', 'paint', 'metal', 'paint', ...repeat(6, 'fabric')],
  'shower-squeegee': [...repeat(4, 'metal'), 'paint', 'rubber'],
  'tissue-box': ['paper', 'paint', 'paper', 'paper'],
  'first-aid-kit': [...repeat(4, 'paint'), 'rubber', 'metal', 'metal'],
  'reed-diffuser': ['wood', 'clear-glass', 'glass', ...repeat(5, 'wood')],
  'board-game': ['wood', ...repeat(36, 'paper'), ...repeat(7, 'paint'), 'metal'],
  'record-player': ['wood', 'rubber', 'paint', 'paper', 'paint', ...repeat(3, 'metal'), 'paint', 'metal', 'metal'],
}

function meshMaterial(mesh: Mesh): MeshStandardMaterial {
  assert.ok(mesh.material instanceof MeshStandardMaterial)
  return mesh.material
}

function fixture(t: TestContext, kind: AdditionalKind) {
  const slot = roomSlots.find((slot) => slot.kinds.includes(kind))
  assert.ok(slot)
  const component = createRoomComponent(kind, slot.id, `surface-${kind}`)
  const appearance = componentMaterialAppearance(component)
  const root = new Group()
  const materials = new Set<MeshStandardMaterial>()
  const variants = new Map<MeshStandardMaterial, Map<RoomSurface, MeshStandardMaterial>>()
  const calls: unknown[] = []
  t.after(() => {
    root.traverse((object) => { if (object instanceof Mesh) object.geometry.dispose() })
    materials.forEach((material) => material.dispose())
  })
  const material: AdditionalModelTools['material'] = (name, color, roughness, surface) => {
    const result = createRoomMaterial(color, roughness, surface, name)
    materials.add(result)
    return result
  }
  const palette: AdditionalModelTools['palette'] = {
    paint: material('paint', appearance?.body.color ?? '#81b29a', 0.65, appearance?.body.surface ?? 'paint'),
    edge: material('edge', appearance ? appearance.edge?.color ?? componentMaterialColors.graphite : '#6b947f',
      0.65, appearance?.edge?.surface ?? 'paint'),
    wood: material('wood', '#ba9164', 0.82, 'wood'),
    lightWood: material('lightWood', '#e4bf88', 0.78, 'wood'),
    cream: material('cream', componentMaterialColors.ceramic, 0.55, 'ceramic'),
    linen: material('linen', appearance?.textile ?? '#f3e5cf', 0.94, 'fabric'),
    dark: material('dark', componentMaterialColors.rubber, 0.9, 'rubber'),
    silver: material('silver', componentMaterialColors.steel, 0.35, 'metal'),
    tomato: material('tomato', '#e07a5f', 0.65, 'paint'),
    leaf: material('leaf', componentMaterialColors.foliage, 0.9, 'foliage'),
    glass: material('glass', componentMaterialColors.glass, 0.18, 'clear-glass'),
  }
  const tools: AdditionalModelTools = {
    root, palette, material, finishes: [palette.paint, palette.edge],
    surface: setRoomMaterialSurface,
    variant: (source, surface) => {
      if (roomMaterialSurface(source) === surface) return source
      let cache = variants.get(source)
      if (!cache) {
        cache = new Map()
        variants.set(source, cache)
      }
      let result = cache.get(surface)
      if (!result) {
        result = createRoomMaterialVariant(source, surface)
        cache.set(surface, result)
        materials.add(result)
      }
      return result
    },
    box: (size, position, material = palette.paint, radius = 0, parent = root) => {
      calls.push({ box: size, position, radius })
      const mesh = new Mesh(new BoxGeometry(...size), material)
      mesh.position.set(...position)
      mesh.castShadow = !material.transparent
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
    cylinder: (radius, height, position, material = palette.paint, top = radius, parent = root) => {
      calls.push({ cylinder: [radius, height, top], position })
      const mesh = new Mesh(new CylinderGeometry(top, radius, height, 12), material)
      mesh.position.set(...position)
      mesh.castShadow = !material.transparent
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    },
  }
  const result = buildAdditionalComponentModel(component, tools)
  assert.ok(result)
  const meshes: Mesh[] = []
  root.traverse((object) => { if (object instanceof Mesh) meshes.push(object) })
  root.updateMatrixWorld(true)
  const fingerprint = createHash('sha256').update(JSON.stringify({
    calls,
    contactSize: result.contactSize,
    finishes: tools.finishes.map((material) => material.name),
    meshes: meshes.map((mesh) => ({
      name: mesh.name,
      parent: mesh.parent === root ? 'root' : mesh.parent?.name,
      position: mesh.position.toArray(),
      rotation: mesh.quaternion.toArray(),
      scale: mesh.scale.toArray(),
      worldTransform: mesh.matrixWorld.toArray(),
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      visible: mesh.visible,
      color: Array.isArray(mesh.material) ? meshSurfaceMaterials(mesh).map((material) => material.color.getHexString())
        : meshMaterial(mesh).color.getHexString(),
      geometry: {
        type: mesh.geometry.type,
        attributes: Object.entries(mesh.geometry.attributes).map(([name, attribute]) => ({
          name, itemSize: attribute.itemSize, normalized: attribute.normalized, array: Array.from(attribute.array),
        })),
        index: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null,
        groups: mesh.geometry.groups,
      },
    })),
  })).digest('hex')
  return { root, meshes, materials, tools, variants, fingerprint }
}

test('the additional-component surface coverage contains all 40 assigned kinds', () => {
  assert.equal(new Set(kinds).size, 40)
  assert.deepEqual(Object.keys(baselines), [...kinds])
  assert.deepEqual(Object.keys(expectedRoles), [...kinds])
})

for (const kind of kinds) {
  test(`${kind} retains its ${kind === 'speaker' ? 'single-piece' : 'rounded'} construction and colors with per-part physical surfaces`, (t) => {
    const { root, fingerprint, meshes, materials, tools, variants } = fixture(t, kind)
    assert.deepEqual(root.position.toArray(), [0, 0, 0])
    assert.deepEqual(root.quaternion.toArray(), [0, 0, 0, 1])
    assert.deepEqual(root.scale.toArray(), [1, 1, 1])
    const assemblies: Group[] = []
    root.traverse((object) => { if (object instanceof Group && object !== root) assemblies.push(object) })
    assert.equal(assemblies.length, kind === 'cookbook-stand' ? 1 : kind === 'tea-set' ? 2 : kind === 'mug-tree' ? 4 : 0)
    assert.ok(assemblies.every((group) => group.visible && ['Cup', 'Book resting on its stand'].includes(group.name)))
    assert.deepEqual(meshes.flatMap((mesh) => meshSurfaceMaterials(mesh).map(roomMaterialSurface)), expectedRoles[kind])
    for (const mesh of meshes) for (const material of meshSurfaceMaterials(mesh)) {
      assert.ok(materials.has(material), 'Every material must use the factory registration')
      const clear = roomMaterialSurface(material) === 'clear-glass'
      assert.equal(material.transparent, clear)
      assert.equal(material.opacity, clear ? 0.28 : 1)
      assert.equal(material.depthWrite, !clear)
      assert.equal(material.emissive.getHex(), 0, 'Physical roles must not introduce electronic state or glowing parts')
      if (roomMaterialSurface(material) !== 'metal') assert.equal(material.metalness, 0)
    }
    for (const [source, cache] of variants) for (const [surface, material] of cache) {
      assert.equal(material, tools.variant(source, surface), 'Repeated physical roles must reuse their cached variant')
      assert.equal(material.color, source.color, 'Variants must follow palette and editable-finish colors')
      assert.equal(roomMaterialSurface(material), surface)
    }
    if (kind === 'oven') {
      assert.equal(meshMaterial(meshes[11]).color, tools.palette.dark.color, 'The oven window uses the existing dark palette')
    }
    assert.equal(fingerprint, baselines[kind], 'Natural materials, geometry, transforms and finish bindings must match the approved model')
  })
}
