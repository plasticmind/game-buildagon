// The heads-up display: hotbar, item chip, clock, control hints, and the soft red
// frame that marks destroy mode.

import { h, kbd, replay, showThumb, formatClock } from './dom.js';
import { icon } from './icons.js';
import { SLOT_COUNT } from '../build/hotbars.js';

export const ITEM_TYPE = 'application/x-buildagon-item';
export const SLOT_TYPE = 'application/x-buildagon-slot';

// Placement types that always sit on the grid, whatever the snap toggle says.
const MAX_DOTS = 8;

const HINTS = [
  [['C'], 'Build menu'],
  [['V'], 'Destroy mode'],
  [['F'], 'Next variant'],
  [['G'], 'Grid snap'],
  [['H'], 'Next preset'],
  [['J'], 'Nature journal'],
  [['F1'], 'All controls'],
];

// Guarded DOM writes: build state can arrive every frame, so only touch what changed.
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setHidden(el, hidden) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

export class Hud {
  constructor(ui) {
    this.ui = ui;
    this.ctx = ui.ctx;
    this.prev = {};
    this.prevPreset = -1;
    this.prevSlot = -1;
    this.minute = null;

    this.el = h('div', { class: 'hud' });
    this.frame = h('div', { class: 'destroy-frame', 'aria-hidden': 'true' });
    this.buildClock();
    this.buildHints();
    this.buildDock();
    this.el.append(this.frame, this.clock, this.hints, this.dock);

    this.setHintsVisible(this.ctx.settings?.showHints !== false);
    this.setPaused(!!this.ctx.settings?.timePaused);
  }

  // ---- Clock ----------------------------------------------------------------

  buildClock() {
    this.clockTime = h('span', { class: 'clock-time' }, '--:--');
    this.clockPause = h('span', { class: 'clock-pause', title: 'Time is paused' }, icon('pause', { size: 14 }));
    this.clock = h(
      'div',
      { class: 'clock' },
      h(
        'span',
        { class: 'clock-icon' },
        icon('sun', { size: 18, className: 'clock-sun' }),
        icon('moon', { size: 18, className: 'clock-moon' }),
      ),
      this.clockTime,
      this.clockPause,
    );
  }

  setTime(hours) {
    if (!Number.isFinite(hours)) return;
    const minute = Math.floor(hours * 60);
    if (minute === this.minute) return;
    this.minute = minute;
    const hh = ((hours % 24) + 24) % 24;
    setText(this.clockTime, formatClock(hh));
    this.clock.classList.toggle('is-night', hh < 6 || hh >= 18.75);
  }

  setPaused(paused) {
    this.clock.classList.toggle('is-paused', paused);
  }

  // ---- Hints ----------------------------------------------------------------

  buildHints() {
    this.hints = h(
      'div',
      { class: 'hints', 'aria-hidden': 'true' },
      HINTS.map(([keys, label]) => h('div', { class: 'hint-row' }, keys.map((k) => kbd(k)), h('span', null, label))),
    );
  }

  // Hints cover the bottom-left panel and the contextual line above the hotbar.
  // Destroy mode keeps its line, so you always know how to get back.
  setHintsVisible(visible) {
    this.hints.classList.toggle('is-off', !visible);
    this.ui.root.classList.toggle('hints-off', !visible);
  }

  // ---- Dock: item chip, preset row, hotbar ----------------------------------

  buildDock() {
    const { build, hotbars } = this.ctx;

    this.itemTitle = h('span', { class: 'chip-title' });
    this.itemSub = h('span', { class: 'chip-sub' });
    this.variantKey = kbd('F');
    this.variantName = h('span', { class: 'chip-variant' });
    this.variantDots = h('span', { class: 'dots', 'aria-hidden': 'true' });
    this.emptyHint = h('span', { class: 'chip-empty' }, 'Press ', kbd('C'), ' to choose an item');
    this.itemChip = h('div', { class: 'chip item-chip' }, this.itemTitle, this.itemSub);

    this.rotateText = h('span');
    this.rotateChip = h(
      'div',
      { class: 'chip chip-small', title: 'Rotation (scroll or the left and right arrows)' },
      icon('rotate', { size: 16 }),
      this.rotateText,
    );
    this.scaleText = h('span');
    this.scaleChip = h(
      'div',
      { class: 'chip chip-small', title: 'Scale (the up and down arrows)' },
      icon('scale', { size: 16 }),
      this.scaleText,
    );

    this.snapBtn = h(
      'button',
      {
        type: 'button',
        class: 'chip chip-btn snap-chip',
        'aria-pressed': 'false',
        'data-sound': 'none',
        onClick: () => build?.toggleSnap?.(),
      },
      icon('snap', { size: 16, className: 'when-on' }),
      icon('free', { size: 16, className: 'when-off' }),
      h('span', null, 'Snap'),
      kbd('G'),
    );

    this.modeLabel = h('span', null, 'Build');
    this.modeBtn = h(
      'button',
      {
        type: 'button',
        class: 'chip chip-btn mode-chip',
        title: 'Switch between building and destroying (V)',
        'data-sound': 'none',
        onClick: () => build?.toggleDestroy?.(),
      },
      icon('build', { size: 16, className: 'when-build' }),
      icon('destroy', { size: 16, className: 'when-destroy' }),
      this.modeLabel,
      kbd('V'),
    );

    this.chipRow = h('div', { class: 'chip-row' }, this.itemChip, this.rotateChip, this.scaleChip, this.snapBtn, this.modeBtn);
    this.hintLine = h('div', { class: 'hint-line', role: 'status', 'aria-live': 'polite' });

    this.presetName = h('span', { class: 'preset-name' });
    this.presetDots = h('span', { class: 'preset-dots' });
    this.presetRow = h(
      'div',
      { class: 'preset-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn preset-arrow',
          'aria-label': 'Previous hotbar preset',
          'data-sound': 'preset',
          onClick: () => hotbars?.cyclePreset(-1),
        },
        icon('chevronLeft', { size: 16 }),
      ),
      h('div', { class: 'preset-label' }, this.presetName, this.presetDots),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-btn preset-arrow',
          'aria-label': 'Next hotbar preset',
          'data-sound': 'preset',
          onClick: () => hotbars?.cyclePreset(1),
        },
        icon('chevronRight', { size: 16 }),
      ),
      kbd('H'),
    );

    this.slots = [];
    for (let i = 0; i < SLOT_COUNT; i++) this.slots.push(this.buildSlot(i));
    this.hotbar = h(
      'div',
      { class: 'hotbar', role: 'toolbar', 'aria-label': 'Hotbar' },
      this.slots.map((s) => s.btn),
    );

    this.dock = h('div', { class: 'dock' }, this.chipRow, this.hintLine, this.presetRow, this.hotbar);
  }

  buildSlot(i) {
    const { hotbars, audio } = this.ctx;
    const thumb = h('span', { class: 'thumb slot-thumb' }, h('img', { alt: '', draggable: 'false' }));
    const btn = h(
      'button',
      { type: 'button', class: 'slot', draggable: 'true', 'data-sound': 'hotbar' },
      h('span', { class: 'slot-key', 'aria-hidden': 'true' }, String(i + 1)),
      thumb,
    );
    btn.addEventListener('click', () => hotbars?.selectSlot(i));

    // Drag a slot onto another slot to swap them.
    btn.addEventListener('dragstart', (e) => {
      const id = hotbars?.preset.slots[i];
      if (!id) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(SLOT_TYPE, String(i));
      e.dataTransfer.setData(ITEM_TYPE, id);
      e.dataTransfer.effectAllowed = 'move';
      const img = thumb.querySelector('img');
      if (img?.src) e.dataTransfer.setDragImage(img, 28, 28);
      this.ui.setDragging(true);
    });
    btn.addEventListener('dragend', () => this.ui.setDragging(false));

    const accepts = (e) => [...(e.dataTransfer?.types ?? [])].includes(ITEM_TYPE);
    const over = (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(SLOT_TYPE) ? 'move' : 'copy';
      btn.classList.add('is-drop');
    };
    btn.addEventListener('dragenter', over);
    btn.addEventListener('dragover', over);
    btn.addEventListener('dragleave', (e) => {
      if (!btn.contains(e.relatedTarget)) btn.classList.remove('is-drop');
    });
    btn.addEventListener('drop', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      btn.classList.remove('is-drop');
      this.ui.setDragging(false);
      if (this.drop(i, e.dataTransfer)) {
        audio?.play('hotbar');
        replay(btn, 'is-landing');
      }
    });

    return { btn, thumb };
  }

  drop(i, dt) {
    const { hotbars } = this.ctx;
    if (!hotbars) return false;
    const from = dt.getData(SLOT_TYPE);
    const id = dt.getData(ITEM_TYPE);
    if (from !== '') {
      const f = Number(from);
      if (!Number.isInteger(f) || f === i) return false;
      const slots = hotbars.preset.slots;
      const a = slots[f] ?? null;
      const b = slots[i] ?? null;
      hotbars.assign(i, a);
      hotbars.assign(f, b);
      return true;
    }
    if (!id || !this.ctx.catalog?.getItem?.(id)) return false;
    hotbars.assign(i, id);
    return true;
  }

  renderHotbar() {
    const { hotbars, catalog } = this.ctx;
    if (!hotbars) return;
    const preset = hotbars.preset;
    const active = hotbars.activeSlot;

    this.slots.forEach(({ btn, thumb }, i) => {
      const id = preset?.slots?.[i] ?? null;
      const item = id ? catalog?.getItem?.(id) : null;
      const name = item?.name ?? (id ? id : 'Empty slot');
      showThumb(thumb, id, id ? this.ui.variantFor(id) : 0, name);
      btn.classList.toggle('is-empty', !id);
      btn.classList.toggle('is-active', i === active);
      btn.setAttribute('aria-pressed', String(i === active));
      btn.setAttribute('aria-label', `Slot ${i + 1}: ${id ? name : 'empty'}`);
      btn.dataset.name = name;
    });

    const presetChanged = hotbars.activePreset !== this.prevPreset;
    if (presetChanged) {
      setText(this.presetName, preset?.name ?? '');
      if (this.prevPreset !== -1) replay(this.presetRow, 'is-swapping');
    }
    if (this.presetDots.childElementCount !== hotbars.presets.length) {
      this.presetDots.replaceChildren(
        ...hotbars.presets.map((p, i) =>
          h(
            'button',
            {
              type: 'button',
              class: 'preset-dot',
              'aria-label': `Preset ${i + 1}: ${p.name}`,
              'data-sound': 'preset',
              onClick: () => hotbars.selectPreset(i),
            },
            h('span'),
          ),
        ),
      );
    }
    [...this.presetDots.children].forEach((dot, i) => {
      dot.classList.toggle('is-active', i === hotbars.activePreset);
      dot.setAttribute('aria-pressed', String(i === hotbars.activePreset));
    });

    if ((presetChanged || active !== this.prevSlot) && this.prevSlot !== -1) {
      const btn = this.slots[active]?.btn;
      if (btn) replay(btn, 'is-bouncing');
    }
    this.prevPreset = hotbars.activePreset;
    this.prevSlot = active;
  }

  // ---- Build state ----------------------------------------------------------

  setState(s) {
    const prev = this.prev;
    this.prev = { ...s };
    const destroy = s.mode === 'destroy';
    this.ui.root.classList.toggle('is-destroy', destroy);

    // Item and variant. The build controller always sends a complete state.
    const { variantCount: count, variant, variantName } = s;
    const hasItem = !!s.itemId;

    this.itemChip.classList.toggle('is-empty', !hasItem);
    setText(this.itemTitle, hasItem ? s.itemName : 'Empty slot');

    if (!hasItem) {
      if (this.itemSub.firstChild !== this.emptyHint) this.itemSub.replaceChildren(this.emptyHint);
    } else {
      if (this.itemSub.firstChild !== this.variantKey) {
        this.itemSub.replaceChildren(this.variantKey, this.variantName, this.variantDots);
      }
      setText(this.variantName, variantName);
      setHidden(this.variantKey, count <= 1);
      this.renderDots(count, variant);
    }
    setHidden(this.itemSub, hasItem && !variantName && count <= 1);

    if (hasItem && s.itemId !== prev.itemId) replay(this.itemChip, 'is-pop');
    else if (hasItem && variant !== prev.variant) {
      replay(this.itemSub, 'is-pop');
      // The active slot shows the selected variant.
      this.renderHotbar();
    }

    // Rotation and scale, for the items that support them.
    setHidden(this.rotateChip, !hasItem || destroy || !s.canRotate);
    setText(this.rotateText, `${s.rotationDeg}°`);
    if (s.canRotate && prev.canRotate && s.rotationDeg !== prev.rotationDeg) replay(this.rotateChip, 'is-tick');
    setHidden(this.scaleChip, !hasItem || destroy || !s.canScale || Math.abs(s.scale - 1) < 0.005);
    setText(this.scaleText, `${Math.round(s.scale * 100)}%`);

    // Snap.
    const locked = s.snapLocked;
    this.snapBtn.classList.toggle('is-on', !!s.snap);
    this.snapBtn.classList.toggle('is-locked', locked && !destroy);
    setAttr(this.snapBtn, 'aria-pressed', String(!!s.snap));
    setAttr(
      this.snapBtn,
      'title',
      locked ? 'Tiles and structures always snap to the grid. G toggles snapping for decorations.' : 'Grid snap for decorations (G)',
    );
    if (prev.snap !== undefined && !!s.snap !== !!prev.snap) replay(this.snapBtn, 'is-pop');

    // Mode.
    setText(this.modeLabel, destroy ? 'Destroy' : 'Build');
    this.modeBtn.classList.toggle('is-destroy', destroy);
    if (prev.mode !== undefined && s.mode !== prev.mode) replay(this.modeBtn, 'is-pop');

    // Validity and hint line.
    this.itemChip.classList.toggle('is-invalid', s.valid === false && !destroy && hasItem);
    setText(this.hintLine, s.hint);
    this.hintLine.classList.toggle('is-visible', !!s.hint);
  }

  renderDots(count, active) {
    const n = Math.min(count, MAX_DOTS);
    setHidden(this.variantDots, count <= 1);
    if (count <= 1) return;
    if (this.variantDots.childElementCount !== n) {
      this.variantDots.replaceChildren(...Array.from({ length: n }, () => h('span', { class: 'dot' })));
    }
    [...this.variantDots.children].forEach((d, i) => d.classList.toggle('is-active', i === Math.min(active, n - 1)));
  }
}
