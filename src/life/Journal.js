// The nature journal: every kind of animal you've seen, when you first saw it,
// and whether you've spotted a golden one. It belongs to the player, not the
// world, so it carries across islands. It also remembers unlocked items, like
// the moonflowers the fairy leaves behind.
//
// Events:
//   'discover'  (entry, { golden })  the first sighting of a kind, or of a golden one
//   'unlock'    (itemId)             an item became available to build

import { Emitter } from '../core/events.js';

const KEY = 'buildagon.journal.v1';

// The order here is the order on the journal's pages.
export const JOURNAL = [
  { id: 'frog', name: 'Frog', called: 'a frog', hint: 'Lily pads', about: 'Sings on lily pads, loudest after dark.' },
  { id: 'duck', name: 'Duck', called: 'a duck', hint: 'A small pond', about: 'Dabbles in small ponds and naps with its head tucked.' },
  { id: 'duckling', name: 'Ducklings', called: 'ducklings', hint: 'Reeds beside a pond', about: 'Paddle out of the reeds after their mother.' },
  { id: 'swan', name: 'Swan', called: 'a swan', hint: 'A lake of 13 or more water tiles', about: 'Glides in pairs on big lakes.' },
  { id: 'koi', name: 'Koi', called: 'koi', hint: 'A bridge or stepping stones by a pond', about: 'Drift under bridges and rise to kiss the surface.' },
  { id: 'fish', name: 'Jumping fish', called: 'a jumping fish', hint: 'A rowboat, or a lake of 4 or more tiles', about: 'Leaps from lakes and around rowboats.' },
  { id: 'butterfly', name: 'Butterfly', called: 'a butterfly', hint: 'Two or more flower patches', about: 'Visits flowers by day and roosts at dusk.' },
  { id: 'songbird', name: 'Songbird', called: 'a songbird', hint: 'Three or more trees together', about: 'Sings in the treetops and pecks on the ground.' },
  { id: 'gull', name: 'Gull', called: 'a gull', hint: 'A sandy beach by the sea', about: 'Circles the beach and stands on the sand.' },
  { id: 'rabbit', name: 'Rabbit', called: 'a rabbit', hint: 'Tall grass, bushes, and ferns', about: 'Nibbles in the long grass and hides at night.' },
  { id: 'cat', name: 'Cat', called: 'a cat', hint: 'A house with a door and a roof', about: 'Moves into a finished house and naps on the step.' },
  {
    id: 'fairy', name: 'Mushroom fairy', called: 'the mushroom fairy', rare: true,
    hint: 'Past midnight, where glowing mushrooms grow in a ring…',
    about: 'Dances over glowing mushroom rings and leaves moonflowers behind.',
  },
  {
    id: 'owl', name: 'Owl', called: 'an owl', rare: true,
    hint: 'A night watcher in the pines…',
    about: 'Keeps watch from the pines at night. Its head follows you all the way around.',
  },
  {
    id: 'whale', name: 'Whale', called: 'a whale', rare: true,
    hint: 'Watch the open sea from a long coast at sunrise or sunset…',
    about: 'Passes far out at sea when the sun is low, spouting as it goes.',
  },
  {
    id: 'fox', name: 'Fox', called: 'a fox', rare: true,
    hint: 'At golden hour, where the woods meet a meadow…',
    about: 'Pounces in the long grass at golden hour and naps by a campfire.',
  },
  {
    id: 'bear', name: 'Bear', called: 'a bear', rare: true,
    hint: 'At dawn, where a waterfall pours into a lake…',
    about: 'Fishes at the foot of a waterfall at dawn.',
  },
  {
    id: 'dragon', name: 'Baby dragon', called: 'a baby dragon', rare: true,
    hint: 'Late at night, by a campfire high on a stone peak…',
    about: 'Curls up by campfires on high peaks and puffs smoke rings.',
  },
  {
    id: 'turtle', name: 'Sea turtles', called: 'sea turtle hatchlings', rare: true,
    hint: 'On a dark, quiet beach at night…',
    about: 'Hatch on dark, quiet beaches and race down the sand to the sea.',
  },
];

export const JOURNAL_BY_ID = new Map(JOURNAL.map((e) => [e.id, e]));

export class Journal extends Emitter {
  constructor({ persist = true } = {}) {
    super();
    this.persist = persist;
    this.seen = {}; // id → { first, golden }
    this.unlocked = new Set();
    this.load();
  }

  get found() {
    return JOURNAL.filter((e) => this.seen[e.id]).length;
  }

  get total() {
    return JOURNAL.length;
  }

  has(id) {
    return !!this.seen[id];
  }

  // Record a sighting. Returns true when it's something new.
  see(id, { golden = false } = {}) {
    const entry = JOURNAL_BY_ID.get(id);
    if (!entry) return false;
    const now = new Date().toISOString();
    const rec = this.seen[id];
    if (!rec) {
      this.seen[id] = { first: now, golden: golden ? now : null };
      this.save();
      this.emit('discover', entry, { golden });
      return true;
    }
    if (golden && !rec.golden) {
      rec.golden = now;
      this.save();
      this.emit('discover', entry, { golden: true });
      return true;
    }
    return false;
  }

  isUnlocked(itemId) {
    return this.unlocked.has(itemId);
  }

  unlock(itemId) {
    if (this.unlocked.has(itemId)) return false;
    this.unlocked.add(itemId);
    this.save();
    this.emit('unlock', itemId);
    return true;
  }

  // Start over (from the journal's own page). Gifts stay unlocked.
  reset() {
    this.seen = {};
    this.save();
  }

  load() {
    if (!this.persist) return;
    try {
      const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (data?.seen && typeof data.seen === 'object') {
        for (const [id, rec] of Object.entries(data.seen)) {
          if (JOURNAL_BY_ID.has(id) && rec?.first) this.seen[id] = { first: rec.first, golden: rec.golden ?? null };
        }
      }
      for (const id of data?.unlocked ?? []) if (typeof id === 'string') this.unlocked.add(id);
    } catch {
      // A broken or missing journal starts fresh.
    }
  }

  save() {
    if (!this.persist) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ seen: this.seen, unlocked: [...this.unlocked] }));
    } catch {
      // Storage can be full or unavailable; the journal still works this session.
    }
  }
}
