// Hotbar presets: several named sets of nine item slots. H cycles presets,
// number keys pick a slot, and the build menu assigns items to the active slot.
//
// Events: 'change' (state) whenever the preset, slot, or contents change.

import { Emitter } from '../core/events.js';
import { DEFAULT_HOTBARS } from '../catalog/catalog.js';

export const SLOT_COUNT = 9;

export class Hotbars extends Emitter {
  constructor(presets = DEFAULT_HOTBARS) {
    super();
    this.presets = presets.map((p) => ({ name: p.name, slots: [...p.slots] }));
    this.activePreset = 0;
    this.activeSlot = 0;
  }

  get preset() {
    return this.presets[this.activePreset];
  }

  get currentItem() {
    return this.preset.slots[this.activeSlot] ?? null;
  }

  selectSlot(i) {
    if (i < 0 || i >= SLOT_COUNT) return;
    this.activeSlot = i;
    this.emit('change', this);
  }

  selectPreset(i) {
    if (i < 0 || i >= this.presets.length) return;
    this.activePreset = i;
    this.emit('change', this);
  }

  cyclePreset(dir = 1) {
    const n = this.presets.length;
    this.selectPreset((this.activePreset + dir + n) % n);
  }

  assign(slot, itemId) {
    this.preset.slots[slot] = itemId;
    this.emit('change', this);
  }

  // Put an item in the active slot, or select it if it's already in this preset.
  pickItem(itemId) {
    const existing = this.preset.slots.indexOf(itemId);
    if (existing >= 0) this.activeSlot = existing;
    else this.preset.slots[this.activeSlot] = itemId;
    this.emit('change', this);
  }

  toJSON() {
    return { presets: this.presets, activePreset: this.activePreset, activeSlot: this.activeSlot };
  }

  // Saves from before a default preset existed get it added at the end.
  fromJSON(data) {
    if (!data?.presets?.length) return;
    this.presets = data.presets.map((p) => ({ name: p.name, slots: [...p.slots] }));
    const names = new Set(this.presets.map((p) => p.name));
    for (const p of DEFAULT_HOTBARS) {
      if (!names.has(p.name)) this.presets.push({ name: p.name, slots: [...p.slots] });
    }
    this.activePreset = Math.min(data.activePreset ?? 0, this.presets.length - 1);
    this.activeSlot = data.activeSlot ?? 0;
    this.emit('change', this);
  }
}
