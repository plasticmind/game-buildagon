// The controls reference, shared by the help overlay and the system menu.
// Matches the controls table in docs/ARCHITECTURE.md.

import { h, kbd } from './dom.js';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = IS_MAC ? '⌘' : 'Ctrl';

// Each row lists alternatives. An alternative is an array of keys pressed
// together (joined with +), unless the row sets `seq` (keys shown side by side).
export const CONTROL_GROUPS = [
  {
    title: 'Fly around',
    rows: [
      { keys: [['W', 'A', 'S', 'D']], seq: true, label: 'Fly' },
      { keys: [['Q'], ['E']], label: 'Down, up' },
      { keys: [['Shift'], ['Ctrl']], label: 'Slow, fast' },
      { keys: [['Right drag'], ['Space', 'Mouse']], label: 'Look around' },
    ],
  },
  {
    title: 'Build',
    rows: [
      { keys: [['Left click']], label: 'Place (drag to paint)' },
      { keys: [['Scroll'], ['←', '→']], seq: true, label: 'Rotate blueprint' },
      { keys: [['↑', '↓']], seq: true, label: 'Scale decoration' },
      { keys: [['C']], label: 'Build menu' },
      { keys: [['V']], label: 'Destroy mode' },
      { keys: [['F'], ['Shift', 'F']], label: 'Next, previous variant' },
      { keys: [['G']], label: 'Grid snap for decorations' },
      { keys: [['1–9']], label: 'Hotbar slot' },
      { keys: [['H'], ['Shift', 'H']], label: 'Next, previous preset' },
      { keys: [['Numpad 1–9']], label: 'Pick a preset' },
      { keys: [[MOD, 'Z'], [MOD, 'Shift', 'Z']], label: 'Undo, redo' },
    ],
  },
  {
    title: 'World',
    rows: [
      { keys: [['T']], label: 'Hold for time-lapse' },
      { keys: [[MOD, 'S']], label: 'Quick save' },
      { keys: [['P']], label: 'Hide the HUD' },
      { keys: [['F1'], ['?']], label: 'Help' },
      { keys: [['Esc']], label: 'Close menus, leave destroy mode, or open the system menu' },
    ],
  },
];

export function renderKeys(alternatives, { seq = false } = {}) {
  const out = [];
  alternatives.forEach((combo, i) => {
    if (i > 0) out.push(h('span', { class: 'key-sep', 'aria-hidden': 'true' }, '/'));
    const group = h('span', { class: 'key-combo' });
    combo.forEach((k, j) => {
      if (j > 0 && !seq) group.append(h('span', { class: 'key-plus', 'aria-hidden': 'true' }, '+'));
      group.append(kbd(k, k.length > 3 ? 'is-wide' : ''));
    });
    out.push(group);
  });
  return out;
}

export function renderControls() {
  return h(
    'div',
    { class: 'controls' },
    CONTROL_GROUPS.map((group) =>
      h(
        'section',
        { class: 'controls-group' },
        h('h3', { class: 'controls-title' }, group.title),
        h(
          'dl',
          { class: 'controls-list' },
          group.rows.map((row) =>
            h(
              'div',
              { class: 'controls-row' },
              h('dt', { class: 'controls-keys' }, renderKeys(row.keys, row)),
              h('dd', { class: 'controls-label' }, row.label),
            ),
          ),
        ),
      ),
    ),
  );
}

// Who each build invites, and what spreads on its own. Matches life/habitats.js
// and life/Growth.js.
export const NATURE_GUIDE = [
  {
    title: 'Who moves in',
    rows: [
      ['Lily pads', 'Frogs'],
      ['A small pond', 'Ducks'],
      ['Reeds beside a pond', 'Ducklings'],
      ['A lake of 13 or more water tiles', 'Swans'],
      ['A bridge or stepping stones by a pond', 'Koi'],
      ['A rowboat, or a lake of 4 or more tiles', 'Jumping fish'],
      ['Two or more flower patches', 'Butterflies'],
      ['Three or more trees together', 'Songbirds'],
      ['A sandy beach by the sea', 'Gulls'],
      ['Tall grass, bushes, and ferns', 'Rabbits'],
      ['A house with a door and a roof', 'A cat'],
    ],
  },
  {
    title: 'What grows on its own',
    rows: [
      ['Flower patches', 'Wildflowers'],
      ['Lily pads on a pond', 'More lily pads'],
      ['Reeds on a bank', 'More reeds'],
      ['Logs, stumps, and shady groves', 'Mushrooms'],
      ['Three or more trees together', 'Young trees'],
    ],
  },
];

export function renderNatureGuide() {
  return h(
    'div',
    { class: 'controls nature-guide' },
    NATURE_GUIDE.map((group) =>
      h(
        'section',
        { class: 'controls-group' },
        h('h3', { class: 'controls-title' }, group.title),
        h(
          'dl',
          { class: 'controls-list' },
          group.rows.map(([build, result]) =>
            h('div', { class: 'controls-row' }, h('dt', { class: 'nature-build' }, build), h('dd', { class: 'controls-label' }, result)),
          ),
        ),
      ),
    ),
    h('p', { class: 'nature-note' }, 'To turn wildlife or growing plants off, press Esc and go to Settings > Nature.'),
  );
}
