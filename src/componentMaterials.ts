import type { ComponentKind, RoomComponent } from '../shared/roomComponents.ts'
import type { RoomSurface } from './surfaceMaterials.ts'

export const componentMaterialColors = {
  enamel: '#eeeee8',
  graphite: '#35393b',
  rubber: '#25292b',
  steel: '#bec5c7',
  glass: '#e0eae8',
  screen: '#202a30',
  ceramic: '#f5f1e8',
  canvas: '#d5c8ae',
  oak: '#bb9669',
  foliage: '#648653',
  foliageLight: '#8eaa6c',
  soil: '#514033',
  terracotta: '#b77e5d',
  apple: '#b95647',
  citrus: '#de984e',
  banana: '#dcc471',
  lime: '#8ba256',
  coffee: '#674831',
  grain: '#d2b47b',
  rice: '#e7dfcd',
  water: '#a5babc',
  medical: '#bc574c',
} as const

type Finish = { color: string; surface: RoomSurface }
export type ComponentMaterialAppearance = {
  body: Finish
  edge?: Finish
  textile?: string
}
const enamel: ComponentMaterialAppearance = { body: { color: componentMaterialColors.enamel, surface: 'paint' } }
const graphite: ComponentMaterialAppearance = { body: { color: componentMaterialColors.graphite, surface: 'paint' } }
const steel: ComponentMaterialAppearance = { body: { color: componentMaterialColors.steel, surface: 'metal' } }
const ceramic: ComponentMaterialAppearance = { body: { color: componentMaterialColors.ceramic, surface: 'ceramic' } }

const appearances: Partial<Record<ComponentKind, ComponentMaterialAppearance>> = {
  dishwasher: enamel,
  'washing-machine': enamel,
  dryer: enamel,
  grinder: graphite,
  microwave: enamel,
  'air-fryer': graphite,
  toaster: steel,
  'water-filter': enamel,
  'dish-rack': steel,
  bins: { body: { color: '#737f75', surface: 'paint' }, edge: { color: '#546158', surface: 'paint' } },
  vacuum: graphite,
  'towel-rack': steel,
  'laundry-basket': { body: { color: componentMaterialColors.canvas, surface: 'fabric' } },
  'drying-rack': enamel,
  'soap-dispenser': ceramic,
  'shower-shelf': steel,
  oven: steel,
  blender: graphite,
  'rice-cooker': enamel,
  speaker: { ...graphite, textile: '#5c605b' },
  'air-purifier': enamel,
  'watering-can': { body: { color: '#597769', surface: 'paint' } },
  'tea-set': ceramic,
  'bathroom-scales': graphite,
  'hair-dryer': graphite,
  'storage-cabinet': { ...enamel, edge: { color: componentMaterialColors.oak, surface: 'wood' } },
  'stand-mixer': enamel,
  'waffle-maker': graphite,
  'kitchen-scale': steel,
  'ironing-board': graphite,
  'toilet-brush': ceramic,
  'shower-squeegee': steel,
  'tissue-box': { body: { color: '#ddd4c1', surface: 'paper' } },
  'first-aid-kit': enamel,
}

export function componentMaterialAppearance(component: Pick<RoomComponent, 'kind' | 'variant'>): ComponentMaterialAppearance | undefined {
  if (component.kind === 'coffee-machine') return component.variant === 'original' ? steel : graphite
  return appearances[component.kind]
}
