// Item catalog: every placeable thing, how it places, and its variants.
//
// placement:
//   'tile'   Terrain hex column. Stacks one level per placement. Always grid-snapped.
//   'water'  Water hex. Digs into land at the same level, or raises existing water.
//   'free'   Freeform decoration. Sits on whatever surface the cursor hits.
//            Snaps to hex points and 30° steps when grid snap (G) is on.
//   'edge'   Sits on a hex edge (walls, fences). Model spans local X, centered on
//            the edge midpoint, length HEX_SIZE, base at y = 0, local +Z faces the
//            cell interior.
//   'cell'   Sits on a hex center (floors, roofs, bridges). Model is centered on
//            the origin, base at y = 0. Rotates in 60° steps; local +X points at an
//            edge midpoint (a bridge spans local X from edge to opposite edge).
//
// stack (edge and cell items):
//   'ground'  Base sits on the terrain rim (floors, bridges).
//   'top'     Base sits on top of the highest structure piece already in that cell
//             or on that edge (walls stack into stories, roofs land on walls).
//
// onWater (free items): 'float' sits on the water surface; 'sink' (default) ignores
// water and sits on the basin floor.
//
// locked: hidden from the build menu until the journal unlocks it (a gift from
// a rare visitor).

import { TERRAIN } from '../core/constants.js';

export const CATEGORIES = [
  { id: 'terrain', name: 'Terrain' },
  { id: 'water', name: 'Water' },
  { id: 'trees', name: 'Trees & Shrubs' },
  { id: 'flora', name: 'Flowers & Plants' },
  { id: 'rocks', name: 'Rocks' },
  { id: 'structures', name: 'Structures' },
  { id: 'furniture', name: 'Furniture' },
  { id: 'props', name: 'Props' },
];

const tileItem = (type, extra = {}) => ({
  id: `tile_${type}`,
  name: `${TERRAIN[type].name} Tile`,
  category: 'terrain',
  placement: 'tile',
  terrainType: type,
  variants: TERRAIN[type].variants.map((v) => v.name),
  sound: type === 'stone' ? 'stone' : type === 'sand' || type === 'snow' ? 'soft' : 'tile',
  dust: true,
  ...extra,
});

export const ITEMS = [
  // ---- Terrain ----
  tileItem('grass'),
  tileItem('meadow'),
  tileItem('sand'),
  tileItem('dirt'),
  tileItem('stone'),
  tileItem('snow'),

  // ---- Water ----
  {
    id: 'tile_water',
    name: 'Water Tile',
    category: 'water',
    placement: 'water',
    terrainType: 'water',
    variants: TERRAIN.water.variants.map((v) => v.name),
    sound: 'water',
  },
  {
    id: 'bridge_arch',
    name: 'Arched Bridge',
    category: 'water',
    placement: 'cell',
    stack: 'ground',
    variants: ['Oak', 'Stone', 'Red Lacquer'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'walkway',
    name: 'Plank Walkway',
    category: 'water',
    placement: 'cell',
    stack: 'ground',
    variants: ['Plank', 'Rope', 'Weathered'],
    sound: 'wood',
  },
  {
    id: 'lily_pads',
    name: 'Lily Pads',
    category: 'water',
    placement: 'free',
    onWater: 'float',
    variants: ['Plain', 'Pink Bloom', 'White Bloom'],
    sound: 'water',
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    id: 'reeds',
    name: 'Reeds',
    category: 'water',
    placement: 'free',
    variants: ['Cattail', 'Reed', 'Rush'],
    sound: 'leaf',
    foliage: true,
    randomRotation: true,
    scaleRange: [0.85, 1.15],
  },
  {
    id: 'boat',
    name: 'Rowboat',
    category: 'water',
    placement: 'free',
    onWater: 'float',
    variants: ['Wood', 'Painted Blue', 'Painted Red'],
    sound: 'wood',
  },
  {
    id: 'footbridge',
    name: 'Footbridge',
    category: 'water',
    placement: 'free',
    onWater: 'float',
    variants: ['Oak', 'Birch'],
    sound: 'wood',
  },

  // ---- Trees & shrubs ----
  {
    id: 'tree_round',
    name: 'Round Tree',
    category: 'trees',
    placement: 'free',
    variants: ['Green', 'Autumn', 'Blossom'],
    sound: 'leaf',
    foliage: true,
    dust: true,
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    id: 'tree_pine',
    name: 'Pine Tree',
    category: 'trees',
    placement: 'free',
    variants: ['Green', 'Blue', 'Snowy'],
    sound: 'leaf',
    foliage: true,
    dust: true,
    randomRotation: true,
    scaleRange: [0.8, 1.3],
  },
  {
    id: 'tree_birch',
    name: 'Birch Tree',
    category: 'trees',
    placement: 'free',
    variants: ['Spring', 'Golden'],
    sound: 'leaf',
    foliage: true,
    dust: true,
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    id: 'tree_willow',
    name: 'Willow Tree',
    category: 'trees',
    placement: 'free',
    variants: ['Green', 'Silver'],
    sound: 'leaf',
    foliage: true,
    dust: true,
    randomRotation: true,
    scaleRange: [0.9, 1.15],
  },
  {
    id: 'bush',
    name: 'Bush',
    category: 'trees',
    placement: 'free',
    variants: ['Round', 'Berry', 'Flowering'],
    sound: 'leaf',
    foliage: true,
    randomRotation: true,
    scaleRange: [0.8, 1.2],
  },
  {
    id: 'stump_log',
    name: 'Stump & Log',
    category: 'trees',
    placement: 'free',
    variants: ['Stump', 'Log', 'Mossy Log'],
    sound: 'wood',
    dust: true,
    randomRotation: true,
  },

  // ---- Flowers & plants ----
  {
    id: 'flowers',
    name: 'Flower Patch',
    category: 'flora',
    placement: 'free',
    variants: ['Tulips', 'Daisies', 'Lavender', 'Poppies'],
    sound: 'leaf',
    foliage: true,
    randomRotation: true,
    scaleRange: [0.85, 1.15],
  },
  {
    id: 'flower_bed',
    name: 'Flower Bed',
    category: 'flora',
    placement: 'free',
    variants: ['Wood', 'Stone'],
    sound: 'wood',
    foliage: true,
    dust: true,
  },
  {
    id: 'tall_grass',
    name: 'Tall Grass',
    category: 'flora',
    placement: 'free',
    variants: ['Green', 'Golden', 'Pampas'],
    sound: 'leaf',
    foliage: true,
    randomRotation: true,
    scaleRange: [0.8, 1.25],
  },
  {
    id: 'ferns',
    name: 'Ferns',
    category: 'flora',
    placement: 'free',
    variants: ['Green', 'Bronze'],
    sound: 'leaf',
    foliage: true,
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    id: 'mushrooms',
    name: 'Mushrooms',
    category: 'flora',
    placement: 'free',
    variants: ['Red', 'Brown', 'Glowing'],
    sound: 'soft',
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    // The mushroom fairy's gift. Hidden from the build menu until she leaves one.
    id: 'moonflower',
    name: 'Moonflower',
    category: 'flora',
    placement: 'free',
    variants: ['Silver', 'Blush'],
    sound: 'leaf',
    foliage: true,
    locked: true,
    randomRotation: true,
    scaleRange: [0.85, 1.15],
    light: { color: '#cfe8ff', intensity: 2.5, distance: 5 },
  },

  // ---- Rocks ----
  {
    id: 'rock_boulder',
    name: 'Boulder',
    category: 'rocks',
    placement: 'free',
    variants: ['Grey', 'Mossy', 'Sandstone'],
    sound: 'stone',
    dust: true,
    randomRotation: true,
    scaleRange: [0.8, 1.3],
  },
  {
    id: 'rock_cluster',
    name: 'Rock Cluster',
    category: 'rocks',
    placement: 'free',
    variants: ['Grey', 'Mossy', 'Sandstone'],
    sound: 'stone',
    dust: true,
    randomRotation: true,
    scaleRange: [0.85, 1.2],
  },
  {
    id: 'stepping_stones',
    name: 'Stepping Stones',
    category: 'rocks',
    placement: 'free',
    onWater: 'float',
    variants: ['Grey', 'Sandstone'],
    sound: 'stone',
    randomRotation: true,
  },
  {
    id: 'rock_spire',
    name: 'Rock Spire',
    category: 'rocks',
    placement: 'free',
    variants: ['Grey', 'Sandstone'],
    sound: 'stone',
    dust: true,
    randomRotation: true,
    scaleRange: [0.85, 1.25],
  },

  // ---- Structures ----
  {
    id: 'floor_wood',
    name: 'Wood Floor',
    category: 'structures',
    placement: 'cell',
    stack: 'ground',
    variants: ['Oak', 'Pine', 'Walnut'],
    sound: 'wood',
    dust: true,
    clearsGrass: true,
  },
  {
    id: 'floor_stone',
    name: 'Stone Floor',
    category: 'structures',
    placement: 'cell',
    stack: 'ground',
    variants: ['Cobble', 'Slate', 'Sandstone'],
    sound: 'stone',
    dust: true,
    clearsGrass: true,
  },
  {
    id: 'wall_plain',
    name: 'Wall',
    category: 'structures',
    placement: 'edge',
    stack: 'top',
    variants: ['Plaster', 'Timber', 'Stone', 'Brick'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'wall_window',
    name: 'Window Wall',
    category: 'structures',
    placement: 'edge',
    stack: 'top',
    variants: ['Plaster', 'Timber', 'Stone', 'Brick'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'wall_door',
    name: 'Door Wall',
    category: 'structures',
    placement: 'edge',
    stack: 'top',
    variants: ['Plaster', 'Timber', 'Stone', 'Brick'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'ceiling_wood',
    name: 'Ceiling',
    category: 'structures',
    placement: 'cell',
    stack: 'top',
    variants: ['Oak', 'Pine', 'Walnut'],
    sound: 'wood',
  },
  {
    id: 'roof_hex',
    name: 'Hex Roof',
    category: 'structures',
    placement: 'cell',
    stack: 'top',
    variants: ['Terracotta', 'Slate', 'Thatch', 'Moss'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'roof_cone',
    name: 'Tower Roof',
    category: 'structures',
    placement: 'cell',
    stack: 'top',
    variants: ['Blue', 'Red', 'Slate'],
    sound: 'wood',
    dust: true,
  },
  {
    id: 'fence',
    name: 'Fence',
    category: 'structures',
    placement: 'edge',
    stack: 'ground',
    variants: ['Picket', 'Rustic', 'Stone'],
    sound: 'wood',
  },

  // ---- Props ----
  {
    id: 'lantern',
    name: 'Lantern',
    category: 'props',
    placement: 'free',
    variants: ['Post', 'Stone', 'String Lights'],
    sound: 'stone',
    light: { color: '#ffc87a', intensity: 6, distance: 9 },
  },
  {
    id: 'campfire',
    name: 'Campfire',
    category: 'props',
    placement: 'free',
    variants: ['Stones', 'Log Ring'],
    sound: 'wood',
    dust: true,
    light: { color: '#ff9a4a', intensity: 9, distance: 11, flicker: 'fire' },
  },
  {
    id: 'bench',
    name: 'Bench',
    category: 'props',
    placement: 'free',
    variants: ['Wood', 'Stone', 'Painted'],
    sound: 'wood',
  },
  {
    id: 'barrels',
    name: 'Barrels & Crates',
    category: 'props',
    placement: 'free',
    variants: ['Barrel', 'Crates', 'Sacks'],
    sound: 'wood',
    randomRotation: true,
  },
  {
    id: 'well',
    name: 'Well',
    category: 'props',
    placement: 'free',
    variants: ['Stone', 'Wood'],
    sound: 'stone',
    dust: true,
  },
  {
    id: 'signpost',
    name: 'Signpost',
    category: 'props',
    placement: 'free',
    variants: ['Wood', 'Painted'],
    sound: 'wood',
  },
  {
    id: 'windmill',
    name: 'Windmill',
    category: 'props',
    placement: 'free',
    variants: ['Classic', 'Red', 'Stone'],
    sound: 'wood',
    dust: true,
  },

  // ---- Furniture ----
  // Sized for one-story rooms: 2.4-unit walls and a door about 1.9 tall.
  {
    id: 'table',
    name: 'Table',
    category: 'furniture',
    placement: 'free',
    variants: ['Oak', 'Round', 'Tablecloth'],
    sound: 'wood',
  },
  {
    id: 'chair',
    name: 'Chair',
    category: 'furniture',
    placement: 'free',
    variants: ['Oak', 'Painted', 'Stool'],
    sound: 'wood',
  },
  {
    id: 'armchair',
    name: 'Armchair',
    category: 'furniture',
    placement: 'free',
    variants: ['Rose', 'Blue', 'Moss'],
    sound: 'soft',
  },
  {
    id: 'bed',
    name: 'Bed',
    category: 'furniture',
    placement: 'free',
    variants: ['Quilt', 'Double', 'Bunk'],
    sound: 'soft',
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'furniture',
    placement: 'free',
    variants: ['Oak', 'Walnut', 'Painted'],
    sound: 'wood',
  },
  {
    id: 'rug',
    name: 'Rug',
    category: 'furniture',
    placement: 'free',
    variants: ['Braided', 'Striped', 'Hex'],
    sound: 'soft',
  },
  {
    id: 'lamp',
    name: 'Lamp',
    category: 'furniture',
    placement: 'free',
    variants: ['Floor', 'Table', 'Candles'],
    sound: 'wood',
    light: { color: '#ffd9a0', intensity: 3, distance: 6 },
  },
  {
    id: 'fireplace',
    name: 'Fireplace',
    category: 'furniture',
    placement: 'free',
    variants: ['Stone', 'Brick', 'Plaster'],
    sound: 'stone',
    dust: true,
    light: { color: '#ff9a4a', intensity: 5.5, distance: 8, flicker: 'fire' },
  },
  {
    id: 'flower_vase',
    name: 'Flower Vase',
    category: 'furniture',
    placement: 'free',
    variants: ['Tulips', 'Daisies', 'Lavender'],
    sound: 'soft',
    randomRotation: true,
  },
  {
    id: 'potted_plant',
    name: 'Potted Plant',
    category: 'furniture',
    placement: 'free',
    variants: ['Fern', 'Cactus', 'Tall Leaf'],
    sound: 'soft',
    randomRotation: true,
    scaleRange: [0.9, 1.1],
  },
];

export const ITEM_BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

export function getItem(id) {
  return ITEM_BY_ID.get(id);
}

export function itemsInCategory(categoryId) {
  return ITEMS.filter((it) => it.category === categoryId);
}

// Default hotbar presets. H cycles them; number keys pick a slot.
export const DEFAULT_HOTBARS = [
  {
    name: 'Landscape',
    slots: ['tile_grass', 'tile_meadow', 'tile_sand', 'tile_dirt', 'tile_stone', 'tile_snow', 'tile_water', 'rock_boulder', 'tree_round'],
  },
  {
    name: 'Garden',
    slots: ['flowers', 'bush', 'tall_grass', 'ferns', 'tree_round', 'tree_birch', 'flower_bed', 'mushrooms', 'rock_cluster'],
  },
  {
    name: 'Village',
    slots: ['floor_wood', 'wall_plain', 'wall_window', 'wall_door', 'roof_hex', 'ceiling_wood', 'fence', 'lantern', 'bench'],
  },
  {
    name: 'Waterside',
    slots: ['tile_water', 'bridge_arch', 'walkway', 'lily_pads', 'reeds', 'boat', 'stepping_stones', 'tree_willow', 'footbridge'],
  },
  {
    name: 'Home',
    slots: ['table', 'chair', 'bed', 'flower_vase', 'bookshelf', 'rug', 'lamp', 'potted_plant', 'fireplace'],
  },
];
