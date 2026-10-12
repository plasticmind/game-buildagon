// World dimensions and shared tuning values. Every module reads scale from here.

export const HEX_SIZE = 2; // Center to corner, in world units. Hexes are pointy-top.
export const HEX_W = Math.sqrt(3) * HEX_SIZE; // Flat-to-flat width.
export const HEX_APOTHEM = HEX_W / 2; // Center to edge midpoint.

export const LEVEL_H = 0.6; // Height of one terrain level.
export const MAX_LEVEL = 12; // Highest terrain level (0-based).
export const BASE_Y = -4; // Bottom of every terrain column and the deep seabed.
export const WATER_DROP = 0.3; // A water cell's surface sits this far below its rim.
export const BASIN_DEPTH = 1.1; // A water cell's basin floor sits this far below its rim.
export const SEA_Y = 0 - WATER_DROP; // Ocean surface. Equals a level-0 water cell's surface.
export const WORLD_RADIUS = 30; // Max hex distance from the origin where placement is allowed.

export const STORY_H = 2.4; // Wall height for modular structures.
export const CHUNK_SIZE = 8; // Terrain and grass chunk size, in axial cells.

// Terrain types and their pastel variants. `top` colors the walkable face, `side`
// colors cliff walls, and `blade` tints grass blades (grass and meadow only).
export const TERRAIN = {
  grass: {
    name: 'Grass',
    variants: [
      { name: 'Lush', top: '#8fc46a', side: '#a9825c', blade: '#7fb85a' },
      { name: 'Spring', top: '#a8d477', side: '#b08a62', blade: '#98cc68' },
      { name: 'Olive', top: '#a3b565', side: '#9c7a57', blade: '#94a957' },
    ],
  },
  meadow: {
    name: 'Meadow',
    variants: [
      { name: 'Wildflower', top: '#b5d67c', side: '#a9825c', blade: '#a6cc6c' },
      { name: 'Clover', top: '#9fd08a', side: '#a9825c', blade: '#8dc47a' },
    ],
  },
  sand: {
    name: 'Sand',
    variants: [
      { name: 'Golden', top: '#efd9a2', side: '#dcc08a' },
      { name: 'Pale', top: '#f4e6c4', side: '#e1cfa6' },
      { name: 'Rose', top: '#f0cfb4', side: '#dcb698' },
    ],
  },
  dirt: {
    name: 'Dirt',
    variants: [
      { name: 'Loam', top: '#c19a6b', side: '#a07c56' },
      { name: 'Clay', top: '#d0a07e', side: '#b0826a' },
      { name: 'Dark', top: '#9b7a5c', side: '#80644b' },
    ],
  },
  stone: {
    name: 'Stone',
    variants: [
      { name: 'Grey', top: '#b9bcc4', side: '#9fa2ab' },
      { name: 'Slate', top: '#a3aebf', side: '#8a95a7' },
      { name: 'Warm', top: '#c8bcae', side: '#ab9f92' },
    ],
  },
  snow: {
    name: 'Snow',
    variants: [
      { name: 'Fresh', top: '#f5f7fb', side: '#c9cfdb' },
      { name: 'Icy', top: '#e4f0f8', side: '#b9c9d8' },
    ],
  },
  water: {
    name: 'Water',
    // `top` here is the basin floor color; `tint` is the water body tint.
    variants: [
      { name: 'Lake', top: '#d6c597', side: '#b9a57c', tint: '#5fb4d6' },
      { name: 'Lagoon', top: '#e0d3a6', side: '#c2b083', tint: '#4fcfc4' },
      { name: 'Pond', top: '#b9b07f', side: '#9e956b', tint: '#6fae9a' },
    ],
  },
};

export const GRASSY_TYPES = new Set(['grass', 'meadow']);

// Shared pastel palette for procedural models. Prefer these over ad-hoc colors.
export const PALETTE = {
  leafGreen: '#7cc46a',
  leafDeep: '#5aa65a',
  leafLight: '#a6dc7c',
  leafAutumn: '#f0a75c',
  leafRust: '#e07f55',
  leafGold: '#f2cf6b',
  blossom: '#f6b6c8',
  blossomDeep: '#ee93ae',
  pineGreen: '#5f9f78',
  pineBlue: '#6c9fa8',
  trunk: '#9a7356',
  trunkDark: '#7c5a44',
  birchBark: '#efeae0',
  birchMark: '#5c5450',
  rock: '#b4b7bf',
  rockDark: '#979aa3',
  moss: '#93b86a',
  sandstone: '#dcc39a',
  woodLight: '#d9b48a',
  wood: '#b98a62',
  woodDark: '#8d6748',
  plaster: '#f3eadb',
  brick: '#d98f78',
  roofRed: '#e07b65',
  roofSlate: '#7f8fa8',
  roofThatch: '#e0c27a',
  roofMoss: '#88a96a',
  roofBlue: '#7aa2d8',
  stoneLight: '#d3d2cd',
  stoneMid: '#b3b1ab',
  metal: '#5b5f6a',
  lanternGlow: '#ffd38a',
  windowGlow: '#ffcf7a',
  flowerRed: '#f2727a',
  flowerYellow: '#ffe07a',
  flowerWhite: '#fbf7ef',
  flowerPurple: '#b79be8',
  flowerPink: '#f7a8c8',
  flowerOrange: '#ffad6b',
  lily: '#79bb6a',
  reed: '#8fae5a',
  cattail: '#8a5f45',
  mushroomRed: '#ec6f64',
  mushroomCap: '#c99b72',
  mushroomGlow: '#8fe8ff',
  fabricRed: '#e58b85',
  fabricBlue: '#86a8d8',
  boat: '#c98f62',
};
