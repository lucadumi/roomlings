import { z } from 'zod'
import { roomIdSchema } from './rooms.ts'
import type { ChoreArea, RoomId } from './rooms.ts'
import { normalizeShoppingName } from './shopping.ts'

export const componentKinds = [
  'fridge', 'sink', 'counters', 'hob', 'kettle', 'table', 'seating', 'plant', 'rug', 'clock', 'light',
  'supply-shelf', 'cleaning-caddy', 'noticeboard', 'receipt-book', 'house-pot', 'shopping-bag', 'settlement-envelope',
  'dishwasher', 'washing-machine', 'dryer', 'coffee-machine', 'grinder', 'microwave', 'air-fryer', 'toaster',
  'water-filter', 'dish-rack', 'bins', 'vacuum', 'bath', 'toilet', 'mirror', 'towel-rack', 'laundry-basket',
  'drying-rack', 'wall-art', 'curtains', 'soap-dispenser', 'shower-shelf',
  'oven', 'blender', 'rice-cooker', 'fruit-bowl', 'spice-rack', 'bread-box', 'knife-block', 'cookbook-stand',
  'paper-towel-holder', 'storage-jars', 'kitchen-cart', 'pet-bowls', 'speaker', 'air-purifier', 'watering-can',
  'tea-set', 'bathroom-scales', 'hair-dryer', 'toothbrush-holder', 'storage-cabinet', 'wall-calendar',
  'key-hooks', 'bath-tray', 'bathroom-stool',
] as const
export const componentKindSchema = z.enum(componentKinds)
export type ComponentKind = z.infer<typeof componentKindSchema>
export const componentCategories = {
  appliances: 'Appliances', fixtures: 'Fixtures', furniture: 'Furniture', decor: 'Decor and plants', household: 'Household tools',
} as const
export type ComponentCategory = keyof typeof componentCategories
export const componentFinishSchema = z.enum(['room', 'cream', 'sage', 'tomato', 'clay', 'walnut'])
export type ComponentFinish = z.infer<typeof componentFinishSchema>
export const componentFinishes: Record<ComponentFinish, { name: string; color: string | null }> = {
  room: { name: 'Match room colors', color: null },
  cream: { name: 'Warm cream', color: '#f5edda' },
  sage: { name: 'Sage green', color: '#8ab27a' },
  tomato: { name: 'Tomato red', color: '#d96d4b' },
  clay: { name: 'Terracotta', color: '#cc9067' },
  walnut: { name: 'Walnut', color: '#806044' },
}
export const roomComponentLimit = 120
export const componentSupplyLimit = 12
export const roomComponentIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Choose a valid room object.')
export const componentSupplySchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Choose a valid supply.'),
  name: z.string().trim().min(1, 'Name this supply.').max(50),
  quantity: z.string().trim().min(1, 'Enter a supply quantity.').max(40),
})
export type ComponentSupply = z.infer<typeof componentSupplySchema>
export type ComponentChoreSuggestion = { title: string; repeatDays: number | null }
export type ComponentDefinition = {
  name: string
  description: string
  category: ComponentCategory
  area: ChoreArea | null
  variants: readonly { id: string; name: string }[]
  states: readonly { id: string; name: string }[]
  supplies: readonly ComponentSupply[]
  chores: readonly ComponentChoreSuggestion[]
}
const supply = (id: string, name: string, quantity = '1 bottle'): ComponentSupply => ({ id, name, quantity })
const chore = (title: string, repeatDays: number | null): ComponentChoreSuggestion => ({ title, repeatDays })
const states = (...names: string[]) => names.map((name) => ({ id: name.toLowerCase().replaceAll(' ', '-'), name }))
const variants = (...names: string[]) => names.map((name, index) => ({ id: index ? name.toLowerCase().replaceAll(' ', '-') : 'original', name }))
const define = (name: string, description: string, category: ComponentCategory, options: Partial<Omit<ComponentDefinition, 'name' | 'description' | 'category'>> = {}): ComponentDefinition => ({
  name, description, category, area: null, variants: variants(name), states: [], supplies: [], chores: [], ...options,
})
const dishSoap = supply('dish-soap', 'Dish soap')
const sponges = supply('sponges', 'Sponges', '1 pack')
const surfaceCleaner = supply('surface-cleaner', 'Surface cleaner')
const bathroomCleaner = supply('bathroom-cleaner', 'Bathroom cleaner')
const descaler = supply('descaler', 'Descaler')
const handSoap = supply('hand-soap', 'Hand soap')

export const componentCatalog: Record<ComponentKind, ComponentDefinition> = {
  fridge: define('Fridge', 'Keep the familiar fridge, with its own care and grocery shortcuts.', 'appliances', {
    area: 'fridge', chores: [chore('Clean the fridge shelves', 14), chore('Check use-by dates', 7), chore('Defrost the freezer', 180)],
    supplies: [surfaceCleaner], states: states('Clear', 'Needs cleaning'),
  }),
  sink: define('Sink', 'A place for dishes, soap and a shared cleaning routine.', 'fixtures', {
    area: 'sink', supplies: [dishSoap, sponges], chores: [chore('Clear the sink', 1), chore('Clean the sink', 7)],
    states: states('Clear', 'Needs cleaning'),
  }),
  counters: define('Kitchen cabinets', 'The fitted cabinets and worktop that hold the kitchen together.', 'fixtures', {
    area: 'counters', supplies: [surfaceCleaner], chores: [chore('Wipe the counters', 1), chore('Organize the cupboards', 30)],
  }),
  hob: define('Hob', 'Keep the cooking surface ready for the next meal.', 'appliances', {
    area: 'counters', supplies: [supply('hob-cleaner', 'Hob cleaner')], chores: [chore('Clean the hob', 7)],
    states: states('Clean', 'Needs cleaning'),
  }),
  kettle: define('Kettle', 'Keep the tea break, and remember the occasional descale.', 'appliances', {
    supplies: [descaler], chores: [chore('Descale the kettle', 30)],
  }),
  table: define('Dining table', 'A shared table, with a choice of shape and wood finish.', 'furniture', {
    variants: variants('Rectangular', 'Round'), chores: [chore('Wipe the table', 1)],
  }),
  seating: define('Kitchen stools', 'A pair of seats with a finish of their own.', 'furniture', {
    chores: [chore('Wipe the seats', 7)],
  }),
  plant: define('Plant', 'A leafy friend, a cactus or a little herb garden.', 'decor', {
    variants: variants('Leafy', 'Cactus', 'Herbs'), supplies: [supply('plant-food', 'Plant food'), supply('potting-soil', 'Potting soil', '1 bag')],
    chores: [chore('Water the plant', 7), chore('Tend the plant', 30)], states: states('Cared for', 'Needs watering'),
  }),
  rug: define('Rug', 'A soft patch of color with its own cleaning schedule.', 'decor', {
    chores: [chore('Vacuum the rug', 7), chore('Wash the rug', 30)],
  }),
  clock: define('Wall clock', 'The working kitchen clock, in a finish you choose.', 'decor', {
    supplies: [supply('batteries', 'Batteries', '1 pack')], chores: [chore('Dust the clock', 30)],
  }),
  light: define('Room light', 'Keep the room lighting, with a different shade finish.', 'decor', {
    supplies: [supply('light-bulbs', 'Light bulbs', '1 pack')], chores: [chore('Dust the light shade', 30)],
  }),
  'supply-shelf': define('Supply shelf', 'Keep general room supplies together without tracking inventory.', 'household', {
    chores: [chore('Organize the supply shelf', 30)],
  }),
  'cleaning-caddy': define('Cleaning caddy', 'The familiar shortcut to room chores, with supplies close by.', 'household', {
    supplies: [surfaceCleaner], chores: [chore('Clean the cleaning caddy', 30)],
  }),
  noticeboard: define('Noticeboard', 'Your roommates remain on the same shared noticeboard.', 'household'),
  'receipt-book': define('Receipt book', 'The same grocery runs and bills, with a cover of your choice.', 'household'),
  'house-pot': define('House pot', 'Your shared grocery budget, never a second balance or a game currency.', 'household'),
  'shopping-bag': define('Shopping bag', 'The same household shopping list and your own basket.', 'household'),
  'settlement-envelope': define('Repayment envelope', 'Keep the shortcut to recorded repayments and the shared ledger.', 'household'),
  dishwasher: define('Dishwasher', 'An optional fitted helper for dishes and its own cleaning supplies.', 'appliances', {
    supplies: [supply('dishwasher-tablets', 'Dishwasher tablets', '1 box'), supply('rinse-aid', 'Rinse aid'), supply('dishwasher-salt', 'Dishwasher salt', '1 bag')],
    chores: [chore('Empty the dishwasher', 1), chore('Clean the dishwasher filter', 30)],
    states: states('Dirty', 'Running', 'Ready to empty', 'Empty'),
  }),
  'washing-machine': define('Washing machine', 'A shared laundry appliance with detergent and maintenance reminders.', 'appliances', {
    supplies: [supply('laundry-detergent', 'Laundry detergent'), supply('fabric-softener', 'Fabric softener'), supply('washing-machine-cleaner', 'Washing machine cleaner')],
    chores: [chore('Run a laundry load', 7), chore('Clean the washing machine', 30)],
    states: states('Idle', 'Running', 'Ready to unload'),
  }),
  dryer: define('Dryer', 'Keep track of a drying load and remember the lint filter.', 'appliances', {
    supplies: [supply('dryer-sheets', 'Dryer sheets', '1 box')], chores: [chore('Clean the dryer lint filter', 7)],
    states: states('Idle', 'Running', 'Ready to unload'),
  }),
  'coffee-machine': define('Coffee machine', 'An espresso, filter or capsule setup for the people who use it.', 'appliances', {
    variants: variants('Espresso', 'Filter', 'Capsule'),
    supplies: [supply('coffee-beans', 'Coffee beans', '1 bag'), descaler],
    chores: [chore('Empty the coffee grounds', 1), chore('Clean the coffee machine', 7), chore('Descale the coffee machine', 60)],
    states: states('Ready', 'Needs cleaning'),
  }),
  grinder: define('Coffee grinder', 'A compact grinder beside the coffee setup.', 'appliances', {
    supplies: [supply('coffee-beans', 'Coffee beans', '1 bag')], chores: [chore('Clean the coffee grinder', 14)],
  }),
  microwave: define('Microwave', 'A countertop microwave with a simple care routine.', 'appliances', {
    supplies: [surfaceCleaner], chores: [chore('Clean the microwave', 7)], states: states('Clean', 'Needs cleaning'),
  }),
  'air-fryer': define('Air fryer', 'Keep its basket clean and its optional liners on the shared list.', 'appliances', {
    supplies: [supply('air-fryer-liners', 'Air fryer liners', '1 pack'), dishSoap],
    chores: [chore('Clean the air fryer basket', 7)], states: states('Clean', 'Needs cleaning'),
  }),
  toaster: define('Toaster', 'A small countertop toaster with a crumb-tray chore.', 'appliances', {
    chores: [chore('Empty the toaster crumb tray', 14)],
  }),
  'water-filter': define('Water filter', 'A filter jug with replacement cartridges and a care schedule.', 'appliances', {
    supplies: [supply('water-filter-cartridges', 'Water filter cartridges', '1 pack')],
    chores: [chore('Replace the water filter', 30), chore('Clean the filter jug', 7)],
    states: states('Ready', 'Filter due'),
  }),
  'dish-rack': define('Dish rack', 'A place to dry dishes, and remember to put them away.', 'fixtures', {
    chores: [chore('Put away the clean dishes', 1), chore('Clean the dish rack', 14)],
    states: states('Clear', 'Dishes drying', 'Ready to put away'),
  }),
  bins: define('Bin', 'Choose rubbish, recycling or compost for this room.', 'fixtures', {
    area: 'bins', variants: variants('Rubbish', 'Recycling', 'Compost'),
    supplies: [supply('rubbish-bags', 'Rubbish bags', '1 roll')],
    chores: [chore('Empty the bin', 3), chore('Wash the bin', 30)], states: states('Clear', 'Needs emptying'),
  }),
  vacuum: define('Vacuum cleaner', 'A cleaning station with filter and dust-container care.', 'appliances', {
    supplies: [supply('vacuum-bags', 'Vacuum bags', '1 pack'), supply('vacuum-filter', 'Vacuum filter', '1 filter')],
    chores: [chore('Empty the vacuum', 7), chore('Clean the vacuum filter', 30)], states: states('Ready', 'Needs emptying'),
  }),
  bath: define('Bath or shower', 'Keep the bath, or fit a walk-in shower in the same designed space.', 'fixtures', {
    area: 'bath', variants: variants('Bath', 'Shower'), supplies: [bathroomCleaner],
    chores: [chore('Clean the bathing area', 7), chore('Clear the drain', 30)], states: states('Clean', 'Needs cleaning'),
  }),
  toilet: define('Toilet', 'Toilet paper, cleaning supplies and the shared cleaning rotation.', 'fixtures', {
    area: 'toilet', supplies: [supply('toilet-paper', 'Toilet paper', '1 pack'), supply('toilet-cleaner', 'Toilet cleaner')],
    chores: [chore('Clean the toilet', 7)],
  }),
  mirror: define('Mirror', 'Keep the bathroom mirror and its wipe-down routine.', 'fixtures', {
    area: 'mirror', supplies: [supply('glass-cleaner', 'Glass cleaner')], chores: [chore('Wipe the mirror', 7)],
  }),
  'towel-rack': define('Towel rail', 'A dedicated place for towels and a regular fresh set.', 'fixtures', {
    chores: [chore('Change the towels', 7), chore('Wash the towels', 7)],
  }),
  'laundry-basket': define('Laundry basket', 'Make the next laundry turn visible to the household.', 'furniture', {
    chores: [chore('Wash the shared laundry', 7)], states: states('Empty', 'Filling up', 'Ready for washing'),
  }),
  'drying-rack': define('Drying rack', 'Hang, dry, fold and put away without inventing a machine timer.', 'furniture', {
    chores: [chore('Fold and put away laundry', 7)], states: states('Empty', 'Drying', 'Ready to fold'),
  }),
  'wall-art': define('Wall art', 'A botanical print or a small geometric composition.', 'decor', {
    variants: variants('Botanical', 'Geometric'), chores: [chore('Dust the picture frame', 30)],
  }),
  curtains: define('Kitchen curtains', 'Dress the existing window without changing how the room is lit.', 'decor', {
    chores: [chore('Wash the curtains', 90)],
  }),
  'soap-dispenser': define('Soap dispenser', 'A small refillable dispenser with a direct restocking shortcut.', 'fixtures', {
    supplies: [handSoap], chores: [chore('Refill the soap dispenser', 14)],
  }),
  'shower-shelf': define('Shower shelf', 'A small shelf for the bathroom supplies your household shares.', 'fixtures', {
    supplies: [supply('shower-gel', 'Shower gel')], chores: [chore('Clean the shower shelf', 14)],
  }),
  oven: define('Oven', 'A fitted oven with a glass door, baking racks and a shared cleaning routine.', 'appliances', {
    supplies: [supply('oven-cleaner', 'Oven cleaner'), supply('baking-paper', 'Baking paper', '1 roll')],
    chores: [chore('Clean the oven', 30), chore('Wash the oven trays', 7)], states: states('Clean', 'Needs cleaning'),
  }),
  blender: define('Blender', 'A little countertop blender for smoothies, soups and quick breakfasts.', 'appliances', {
    supplies: [dishSoap], chores: [chore('Wash the blender jug', 7)], states: states('Clean', 'Needs cleaning'),
  }),
  'rice-cooker': define('Rice cooker', 'A rounded cooker for easy shared meals, with a removable pot to clean.', 'appliances', {
    supplies: [supply('rice', 'Rice', '1 bag')], chores: [chore('Wash the rice cooker pot', 7)], states: states('Clean', 'Needs cleaning'),
  }),
  'fruit-bowl': define('Fruit bowl', 'A colorful bowl for the fruit your household likes to keep around.', 'decor', {
    supplies: [supply('apples', 'Apples', '6 apples'), supply('bananas', 'Bananas', '1 bunch')],
    chores: [chore('Check the fruit bowl', 3), chore('Wash the fruit bowl', 14)],
  }),
  'spice-rack': define('Spice rack', 'Keep little jars of seasoning together on a rack or counter.', 'fixtures', {
    supplies: [supply('salt', 'Salt', '1 pack'), supply('black-pepper', 'Black pepper', '1 jar'), supply('mixed-herbs', 'Mixed herbs', '1 jar')],
    chores: [chore('Refill and tidy the spices', 30)],
  }),
  'bread-box': define('Bread box', 'A wooden bread box with a roll-top lid and space for daily staples.', 'furniture', {
    supplies: [supply('bread', 'Bread', '1 loaf')], chores: [chore('Clear crumbs from the bread box', 7)],
  }),
  'knife-block': define('Knife block', 'A compact wooden block that keeps the cooking tools in one place.', 'fixtures', {
    chores: [chore('Clean the knife block', 30)],
  }),
  'cookbook-stand': define('Cookbook stand', 'Keep a favorite recipe open while the household cooks together.', 'decor', {
    chores: [chore('Wipe the cookbook stand', 14)],
  }),
  'paper-towel-holder': define('Paper towel holder', 'A reusable stand with a shortcut for the next roll.', 'fixtures', {
    supplies: [supply('paper-towels', 'Paper towels', '2 rolls')], chores: [chore('Refill the paper towels', 7)],
  }),
  'storage-jars': define('Storage jars', 'A little set of lidded jars for staples or everyday supplies.', 'furniture', {
    chores: [chore('Wash and refill the storage jars', 30)],
  }),
  'kitchen-cart': define('Kitchen cart', 'A small wheeled cart with two shelves for the things that need a home.', 'furniture', {
    supplies: [surfaceCleaner], chores: [chore('Tidy the kitchen cart', 7), chore('Wipe the cart shelves', 14)],
  }),
  'pet-bowls': define('Pet bowls', 'Two little bowls on a mat, with shared care tasks and supply shortcuts.', 'fixtures', {
    supplies: [supply('pet-food', 'Pet food', '1 bag')], chores: [chore('Refresh the pet water bowl', 1), chore('Wash the pet bowls', 7)],
    states: states('Ready', 'Needs refilling'),
  }),
  speaker: define('Speaker', 'A small speaker for a room that feels lived in.', 'decor', {
    chores: [chore('Dust the speaker', 14)],
  }),
  'air-purifier': define('Air purifier', 'A compact air purifier with a reminder to look after its filter.', 'appliances', {
    supplies: [supply('air-purifier-filter', 'Air purifier filter', '1 filter')],
    chores: [chore('Clean the air purifier filter', 30)], states: states('Ready', 'Filter due'),
  }),
  'watering-can': define('Watering can', 'A bright little watering can to keep near your plants.', 'decor', {
    chores: [chore('Rinse the watering can', 30)],
  }),
  'tea-set': define('Tea set', 'A teapot and cups on a tray, ready for a shared tea break.', 'decor', {
    supplies: [supply('tea-bags', 'Tea bags', '1 box')], chores: [chore('Wash the tea set', 7)],
  }),
  'bathroom-scales': define('Bathroom scales', 'A simple bathroom scale without collecting personal measurements.', 'appliances', {
    supplies: [supply('batteries', 'Batteries', '1 pack')], chores: [chore('Wipe the bathroom scales', 14)],
  }),
  'hair-dryer': define('Hair dryer', 'Give the hair dryer a place to live and a filter-cleaning reminder.', 'appliances', {
    chores: [chore('Clean the hair dryer filter', 30)],
  }),
  'toothbrush-holder': define('Toothbrush holder', 'Keep the bathroom counter tidy with a little cup for brushes.', 'fixtures', {
    supplies: [supply('toothpaste', 'Toothpaste', '1 tube')], chores: [chore('Wash the toothbrush holder', 7)],
  }),
  'storage-cabinet': define('Storage cabinet', 'A freestanding cabinet for towels, supplies or the little things around home.', 'furniture', {
    chores: [chore('Organize the storage cabinet', 30), chore('Wipe the cabinet shelves', 30)],
  }),
  'wall-calendar': define('Wall calendar', 'A paper calendar corner with a weekly household-planning routine.', 'decor', {
    chores: [chore('Plan the household week', 7)],
  }),
  'key-hooks': define('Key hooks', 'A small wall rail for keys and other things you grab on the way out.', 'fixtures', {
    chores: [chore('Tidy the key hooks', 30)],
  }),
  'bath-tray': define('Bath tray', 'A wooden tray across the bathtub for a book and a folded cloth.', 'furniture', {
    chores: [chore('Clean and dry the bath tray', 7)],
  }),
  'bathroom-stool': define('Bathroom stool', 'A little wooden step stool with a finish of its own.', 'furniture', {
    chores: [chore('Wipe the bathroom stool', 7)],
  }),
}

type PlacementRequirement = { slotId: string; variant: string; message: string }
const slot = <Id extends string>(id: Id, roomId: RoomId, name: string, kinds: readonly ComponentKind[], defaultKind: ComponentKind | null = null, removable = true, requires?: PlacementRequirement) =>
  ({ id, roomId, name, kinds, defaultKind, removable, requires })
const counterAppliances = ['coffee-machine', 'microwave', 'air-fryer', 'toaster', 'blender', 'rice-cooker'] as const
const tableAccessories = ['plant', 'fruit-bowl', 'bread-box', 'cookbook-stand', 'storage-jars', 'paper-towel-holder', 'tea-set', 'speaker', 'watering-can'] as const
const floorStorage = ['plant', 'storage-cabinet', 'kitchen-cart', 'pet-bowls', 'air-purifier', 'vacuum'] as const
const wallAccessories = ['wall-art', 'wall-calendar', 'key-hooks', 'spice-rack'] as const

export const roomSlots = [
  slot('kitchen-fridge', 'kitchen', 'Fridge corner', ['fridge'], 'fridge', false),
  slot('kitchen-sink', 'kitchen', 'Fitted sink', ['sink'], 'sink', false),
  slot('kitchen-counters', 'kitchen', 'Fitted cabinets', ['counters'], 'counters', false),
  slot('kitchen-hob', 'kitchen', 'Cooking surface', ['hob'], 'hob', false),
  slot('kitchen-kettle', 'kitchen', 'Kettle spot', ['kettle'], 'kettle'),
  slot('kitchen-table', 'kitchen', 'Dining table', ['table'], 'table', false),
  slot('kitchen-seating', 'kitchen', 'Kitchen seating', ['seating'], 'seating'),
  slot('kitchen-plant-floor', 'kitchen', 'Floor planter', floorStorage, 'plant'),
  slot('kitchen-plant-counter', 'kitchen', 'Counter planter', ['plant'], 'plant'),
  slot('kitchen-rug', 'kitchen', 'Dining rug', ['rug'], 'rug'),
  slot('kitchen-clock', 'kitchen', 'Wall clock', ['clock'], 'clock'),
  slot('kitchen-light', 'kitchen', 'Pendant light', ['light'], 'light', false),
  slot('kitchen-curtains', 'kitchen', 'Window curtains', ['curtains'], 'curtains'),
  slot('kitchen-supply-shelf', 'kitchen', 'Supply shelf', ['supply-shelf'], 'supply-shelf', false),
  slot('kitchen-cleaning-caddy', 'kitchen', 'Cleaning caddy', ['cleaning-caddy'], 'cleaning-caddy', false),
  slot('kitchen-noticeboard', 'kitchen', 'Household noticeboard', ['noticeboard'], 'noticeboard', false),
  slot('kitchen-receipt-book', 'kitchen', 'Receipt book', ['receipt-book'], 'receipt-book', false),
  slot('kitchen-house-pot', 'kitchen', 'House pot', ['house-pot'], 'house-pot', false),
  slot('kitchen-shopping-bag', 'kitchen', 'Shopping bag', ['shopping-bag'], 'shopping-bag', false),
  slot('kitchen-settlement-envelope', 'kitchen', 'Repayment envelope', ['settlement-envelope'], 'settlement-envelope', false),
  slot('kitchen-undercounter', 'kitchen', 'Fitted appliance bay', ['dishwasher', 'washing-machine', 'dryer', 'oven']),
  slot('kitchen-coffee', 'kitchen', 'Coffee corner', counterAppliances),
  slot('kitchen-small-appliance', 'kitchen', 'Countertop appliance spot', counterAppliances),
  slot('kitchen-drinks', 'kitchen', 'Small drinks accessory', ['grinder', 'water-filter', 'tea-set', 'speaker', 'storage-jars', 'fruit-bowl']),
  slot('kitchen-dish-rack', 'kitchen', 'Beside the sink', ['dish-rack', 'paper-towel-holder', 'knife-block', 'spice-rack', 'watering-can']),
  slot('kitchen-bins', 'kitchen', 'Bin corner', ['bins']),
  slot('kitchen-vacuum', 'kitchen', 'Cleaning station', floorStorage),
  slot('kitchen-wall-art', 'kitchen', 'Wall picture', wallAccessories),
  slot('kitchen-soap-dispenser', 'kitchen', 'Sink dispenser', ['soap-dispenser']),
  slot('kitchen-table-center', 'kitchen', 'Table centerpiece', tableAccessories),
  slot('kitchen-windowsill', 'kitchen', 'Window ledge', ['plant', 'storage-jars', 'speaker']),
  slot('kitchen-left-wall', 'kitchen', 'Side wall', wallAccessories),
  slot('bathroom-sink', 'bathroom', 'Bathroom basin', ['sink'], 'sink', false),
  slot('bathroom-mirror', 'bathroom', 'Vanity mirror', ['mirror'], 'mirror', false),
  slot('bathroom-toilet', 'bathroom', 'Toilet', ['toilet'], 'toilet', false),
  slot('bathroom-bath', 'bathroom', 'Bathing area', ['bath'], 'bath', false),
  slot('bathroom-supply-shelf', 'bathroom', 'Bathroom supply shelf', ['supply-shelf'], 'supply-shelf', false),
  slot('bathroom-cleaning-caddy', 'bathroom', 'Bathroom cleaning caddy', ['cleaning-caddy'], 'cleaning-caddy', false),
  slot('bathroom-laundry', 'bathroom', 'Laundry appliance spot', ['washing-machine', 'dryer']),
  slot('bathroom-laundry-basket', 'bathroom', 'Laundry basket spot', ['laundry-basket', 'storage-cabinet', 'bathroom-stool', 'air-purifier']),
  slot('bathroom-drying-rack', 'bathroom', 'Drying rack spot', ['drying-rack']),
  slot('bathroom-towel-rack', 'bathroom', 'Towel rail', ['towel-rack']),
  slot('bathroom-plant', 'bathroom', 'Bathroom planter', ['plant', 'air-purifier', 'storage-cabinet', 'bathroom-stool']),
  slot('bathroom-wall-art', 'bathroom', 'Bathroom wall picture', ['wall-art', 'wall-calendar', 'key-hooks']),
  slot('bathroom-soap-dispenser', 'bathroom', 'Basin dispenser', ['soap-dispenser']),
  slot('bathroom-shower-shelf', 'bathroom', 'Bathing area shelf', ['shower-shelf']),
  slot('bathroom-bins', 'bathroom', 'Bathroom bin', ['bins']),
  slot('bathroom-vanity-accessory', 'bathroom', 'Vanity corner', ['soap-dispenser', 'toothbrush-holder', 'hair-dryer', 'storage-jars', 'plant']),
  slot('bathroom-floor-storage', 'bathroom', 'Front storage spot', ['plant', 'laundry-basket', 'storage-cabinet', 'bathroom-stool', 'bathroom-scales', 'air-purifier', 'vacuum']),
  slot('bathroom-bath-tray', 'bathroom', 'Across the bathtub', ['bath-tray'], null, true, {
    slotId: 'bathroom-bath', variant: 'original', message: 'This position needs the bathtub. Remove the bath tray before choosing a shower.',
  }),
] as const
export type RoomSlotId = typeof roomSlots[number]['id']
export const roomSlotIdSchema = z.enum(roomSlots.map((slot) => slot.id), { error: 'Choose a designed position in this home.' })

const suppliesSchema = z.array(componentSupplySchema).max(componentSupplyLimit)
  .refine((supplies) => new Set(supplies.map((supply) => supply.id)).size === supplies.length, 'Choose each supply only once.')
  .refine((supplies) => new Set(supplies.map((supply) => normalizeShoppingName(supply.name))).size === supplies.length, 'Use a distinct name for each supply.')
const componentFields = {
  id: roomComponentIdSchema, kind: componentKindSchema, roomId: roomIdSchema, slotId: roomSlotIdSchema,
  name: z.string().trim().min(1, 'Give this object a name.').max(50),
  variant: z.string().min(1).max(40), finish: componentFinishSchema,
  supplies: suppliesSchema, installed: z.boolean(),
}
type ComponentFields = z.infer<z.ZodObject<typeof componentFields>>
function validateComponent(component: ComponentFields, context: z.RefinementCtx) {
  const position = roomSlots.find((slot) => slot.id === component.slotId)
  if (!position || position.roomId !== component.roomId || !position.kinds.includes(component.kind)) {
    context.addIssue({ code: 'custom', message: 'This object does not fit that room position.', path: ['slotId'] })
  }
  if (!componentCatalog[component.kind].variants.some((variant) => variant.id === component.variant)) {
    context.addIssue({ code: 'custom', message: 'Choose a model made for this object.', path: ['variant'] })
  }
  if (position && !position.removable && !component.installed) {
    context.addIssue({ code: 'custom', message: 'This fitted object stays in the room. You can still customize it.', path: ['installed'] })
  }
}
export const roomComponentSchema = z.object({
  ...componentFields, version: z.number().int().nonnegative(),
  state: z.string().min(1).max(40).nullable(), stateChangedAt: z.string().datetime().nullable(), stateChangedBy: z.string().uuid().nullable(),
}).superRefine((component, context) => {
  validateComponent(component, context)
  if (component.state !== null && !componentCatalog[component.kind].states.some((state) => state.id === component.state)) {
    context.addIssue({ code: 'custom', message: 'Choose a state supported by this object.', path: ['state'] })
  }
  if ((component.stateChangedAt === null) !== (component.stateChangedBy === null)) {
    context.addIssue({ code: 'custom', message: 'A state change needs its time and roommate.', path: ['stateChangedAt'] })
  }
})
export type RoomComponent = z.infer<typeof roomComponentSchema>
export const roomComponentChangeSchema = z.object({
  ...componentFields,
  componentVersion: z.number().int().nonnegative().nullable(),
  linkedChores: z.enum(['keep', 'archive']).optional(),
}).superRefine(validateComponent)
export type RoomComponentChange = z.infer<typeof roomComponentChangeSchema>
export const roomComponentsPatchSchema = z.object({
  roomId: roomIdSchema, changes: z.array(roomComponentChangeSchema).min(1, 'Change an object before applying.').max(roomSlots.length),
}).superRefine((patch, context) => {
  if (new Set(patch.changes.map((change) => change.id)).size !== patch.changes.length) {
    context.addIssue({ code: 'custom', message: 'Update each object only once.', path: ['changes'] })
  }
  if (patch.changes.some((change) => change.roomId !== patch.roomId)) {
    context.addIssue({ code: 'custom', message: 'Apply changes to one room at a time.', path: ['changes'] })
  }
})
export type RoomComponentsPatch = z.infer<typeof roomComponentsPatchSchema>
export const componentStateInputSchema = z.object({
  componentVersion: z.number().int().nonnegative(), state: z.string().min(1).max(40).nullable(),
})
export const componentSourceInputSchema = z.object({
  componentId: roomComponentIdSchema, supplyId: componentSupplySchema.shape.id,
})
export const componentSourceSnapshotSchema = componentSourceInputSchema.extend({
  roomId: roomIdSchema, componentName: componentFields.name,
})
export type ComponentSourceSnapshot = z.infer<typeof componentSourceSnapshotSchema>

export function suggestedComponentSupplies(component: Pick<RoomComponent, 'kind' | 'roomId' | 'variant'>): ComponentSupply[] {
  const { kind, roomId, variant } = component
  let supplies = componentCatalog[kind].supplies
  if (kind === 'sink' && roomId === 'bathroom') supplies = [handSoap]
  if (kind === 'cleaning-caddy' && roomId === 'bathroom') supplies = [bathroomCleaner]
  if (kind === 'supply-shelf') supplies = roomId === 'kitchen'
    ? [supply('rubbish-bags', 'Rubbish bags', '1 roll')]
    : [supply('toilet-paper', 'Toilet paper', '1 pack'), handSoap, bathroomCleaner]
  if (kind === 'coffee-machine' && variant === 'capsule') supplies = [supply('coffee-capsules', 'Coffee capsules', '1 box'), descaler]
  if (kind === 'coffee-machine' && variant === 'filter') supplies = [
    supply('ground-coffee', 'Ground coffee', '1 bag'), supply('coffee-filters', 'Coffee filters', '1 pack'), descaler,
  ]
  if (kind === 'bins' && variant === 'compost') supplies = [supply('compost-liners', 'Compost liners', '1 roll')]
  return supplies.map((supply) => ({ ...supply }))
}

export function createRoomComponent(kind: ComponentKind, slotId: RoomSlotId, id: string): RoomComponent {
  const position = roomSlots.find((slot) => slot.id === slotId)
  if (!position || !position.kinds.includes(kind)) throw new Error('Choose a position that supports this object.')
  const definition = componentCatalog[kind]
  const variant = definition.variants[0].id
  return roomComponentSchema.parse({
    id, kind, slotId, roomId: position.roomId, name: kind === 'sink' && position.roomId === 'bathroom' ? 'Bathroom sink' : definition.name,
    variant, finish: 'room', supplies: suggestedComponentSupplies({ kind, roomId: position.roomId, variant }),
    version: 0, installed: true, state: null, stateChangedAt: null, stateChangedBy: null,
  })
}

export function defaultRoomComponents(): RoomComponent[] {
  return roomSlots.flatMap((slot) => slot.defaultKind ? [createRoomComponent(slot.defaultKind, slot.id, `default-${slot.id}`)] : [])
}

export function getRoomComponents(household: { roomComponents?: readonly RoomComponent[] }): readonly RoomComponent[] {
  return household.roomComponents ?? defaultRoomComponents()
}

export function availableComponentSlots(components: readonly RoomComponent[], roomId: RoomId, kind: ComponentKind) {
  return roomSlots.filter((slot) => slot.roomId === roomId && slot.kinds.includes(kind)
    && componentPositionSupported(slot.id, components)
    && !components.some((component) => component.installed && component.slotId === slot.id))
}

export function componentPositionSupported(slotId: RoomSlotId, components: readonly RoomComponent[]): boolean {
  const position = roomSlots.find((slot) => slot.id === slotId)
  if (!position) return false
  const requirement = position.requires
  return !requirement || components.some((component) => component.installed && component.slotId === requirement.slotId && component.variant === requirement.variant)
}

export function componentChoreArea(component: Pick<RoomComponent, 'kind' | 'roomId'>): ChoreArea | null {
  const area = componentCatalog[component.kind].area
  return component.roomId === 'bathroom' && area === 'bins' ? null : area
}

export function componentChoreMatches(
  chore: { roomId: RoomId | null; area: ChoreArea | null; componentId?: string | null },
  component: RoomComponent,
): boolean {
  if (chore.componentId) return chore.componentId === component.id
  const area = componentChoreArea(component)
  return component.id === `default-${component.slotId}` && area !== null && chore.roomId === component.roomId && chore.area === area
}

export function validateRoomComponents(components: readonly RoomComponent[]): string | null {
  if (components.length > roomComponentLimit) return 'This home has reached its saved-object limit. Restore an existing object instead.'
  const ids = new Set<string>()
  const installedSlots = new Set<string>()
  for (const component of components) {
    if (ids.has(component.id)) return 'Room objects must have distinct identifiers.'
    ids.add(component.id)
    if (!component.installed) continue
    if (!componentPositionSupported(component.slotId, components)) {
      return roomSlots.find((slot) => slot.id === component.slotId)?.requires?.message ?? 'This position is not supported by the current room.'
    }
    if (installedSlots.has(component.slotId)) return 'Two objects cannot occupy the same designed position.'
    installedSlots.add(component.slotId)
  }
  if (roomSlots.some((slot) => !slot.removable && !installedSlots.has(slot.id))) return 'Keep the fitted objects and household tools in their room positions.'
  return null
}
