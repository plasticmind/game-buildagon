// System menu (Esc): resume, save, load, new world, settings, controls, and about.

import { h, replay, uniqueId, formatDate, formatClock } from './dom.js';
import { icon } from './icons.js';
import { Modal } from './Modal.js';
import { renderControls } from './controls.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { TRACKS } from '../audio/tracks.js';

const PAGES = [
  { id: 'save', label: 'Save', icon: 'save' },
  { id: 'load', label: 'Load', icon: 'folder' },
  { id: 'new', label: 'New world', icon: 'island' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
  { id: 'controls', label: 'Controls', icon: 'keyboard' },
  { id: 'about', label: 'About', icon: 'help' },
];

const pct = (v) => `${Math.round(v * 100)}%`;
const times = (v) => `${Number(v).toFixed(2)}×`;
const windWord = (v) => (v < 0.05 ? 'Still' : v < 0.6 ? 'Light' : v < 1.25 ? 'Breezy' : v < 1.7 ? 'Windy' : 'Gusty');

const SETTINGS = [
  {
    title: 'Sound',
    items: [
      { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'sfxVolume', label: 'Sound effects', type: 'range', min: 0, max: 1, step: 0.01, format: pct, preview: 'ui_click' },
      { key: 'ambienceVolume', label: 'Ambience', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      { key: 'musicVolume', label: 'Music', type: 'range', min: 0, max: 1, step: 0.01, format: pct },
      {
        key: 'musicStyle',
        label: 'Music style',
        type: 'segmented',
        options: [
          ['piano', 'Piano'],
          ['chimes', 'Chimes'],
          ['off', 'Off'],
        ],
      },
    ],
  },
  {
    title: 'Camera',
    items: [
      { key: 'mouseSensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, format: times },
      { key: 'invertY', label: 'Invert vertical look', type: 'switch' },
      { key: 'cameraSpeed', label: 'Camera speed', type: 'range', min: 0.25, max: 3, step: 0.05, format: times },
    ],
  },
  {
    title: 'Time',
    items: [
      { key: 'timeOfDay', label: 'Time of day', type: 'time' },
      {
        key: 'dayLengthMinutes',
        label: 'Day length',
        help: 'Real minutes per day',
        type: 'range',
        min: 2,
        max: 60,
        step: 1,
        format: (v) => `${v} min`,
      },
      { key: 'timePaused', label: 'Pause time', type: 'switch' },
    ],
  },
  {
    title: 'World and graphics',
    items: [
      { key: 'windStrength', label: 'Wind strength', type: 'range', min: 0, max: 2, step: 0.05, format: windWord },
      {
        key: 'quality',
        label: 'Graphics quality',
        type: 'segmented',
        options: [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ],
      },
      { key: 'grassDensity', label: 'Grass density', type: 'range', min: 0, max: 1, step: 0.05, format: pct, heavy: true },
      { key: 'showHints', label: 'Show control hints', type: 'switch' },
    ],
  },
];

function setFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const t = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${Math.max(0, Math.min(100, t))}%`);
}

export class SystemMenu extends Modal {
  constructor(ui) {
    super(ui, { className: 'system-menu', layerClass: 'layer-system', labelledBy: 'system-title' });
    this.page = 'save';
    this.navButtons = {};
    this.syncers = [];
    this.time = 12;
    this.timeDragging = false;

    const nav = h(
      'nav',
      { class: 'sys-nav', 'aria-label': 'System menu' },
      h(
        'div',
        { class: 'brand' },
        h('span', { class: 'brand-logo' }, icon('logo', { size: 34 })),
        h('div', null, h('span', { class: 'brand-name' }, 'Buildagon'), h('span', { class: 'brand-sub' }, 'Paused')),
      ),
      h(
        'button',
        { type: 'button', class: 'nav-btn nav-resume', 'data-sound': 'none', onClick: () => ui.toggleSystemMenu(false) },
        icon('play', { size: 18 }),
        'Resume',
      ),
      h('div', { class: 'nav-rule', role: 'presentation' }),
      PAGES.map((p) => {
        const btn = h(
          'button',
          { type: 'button', class: 'nav-btn', onClick: () => this.show(p.id) },
          icon(p.icon, { size: 18 }),
          p.label,
        );
        this.navButtons[p.id] = btn;
        return btn;
      }),
    );

    this.title = h('h2', { id: 'system-title', class: 'sys-title' });
    this.content = h('div', { class: 'sys-content', tabindex: '-1' });
    const body = h(
      'div',
      { class: 'sys-body' },
      h(
        'header',
        { class: 'sys-head' },
        this.title,
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn close-btn',
            'aria-label': 'Close the menu',
            'data-sound': 'none',
            onClick: () => ui.toggleSystemMenu(false),
          },
          icon('close', { size: 18 }),
        ),
      ),
      this.content,
    );
    this.panel.append(nav, body);

    this.settingsPage = this.buildSettings();
    this.controlsPage = h('div', { class: 'page page-controls' }, renderControls());
  }

  get saves() {
    return this.ui.ctx.saves;
  }

  get audio() {
    return this.ui.ctx.audio;
  }

  onOpen() {
    this.show(this.page);
  }

  focusTarget() {
    return this.panel.querySelector('.nav-resume');
  }

  show(page) {
    this.page = page;
    for (const [id, btn] of Object.entries(this.navButtons)) {
      const on = id === page;
      btn.classList.toggle('is-current', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
    this.title.textContent = PAGES.find((p) => p.id === page)?.label ?? '';
    const node = this.renderPage(page);
    this.content.replaceChildren(node);
    this.content.scrollTop = 0;
    replay(node, 'page-in');
  }

  renderPage(page) {
    switch (page) {
      case 'save':
        return this.renderSave();
      case 'load':
        return this.renderLoad();
      case 'new':
        return this.renderNew();
      case 'settings':
        this.syncSettings();
        return this.settingsPage;
      case 'about':
        return this.renderAbout();
      default:
        return this.controlsPage;
    }
  }

  // Re-render the current page and put focus back on the same control.
  refresh() {
    const key = document.activeElement?.dataset?.focusKey;
    const node = this.renderPage(this.page);
    this.content.replaceChildren(node);
    if (key) this.content.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  // ---- About ---------------------------------------------------------------

  renderAbout() {
    const playing = this.audio?.nowPlaying;
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

    const play = (track) => {
      if (this.audio?.nowPlaying === track) {
        this.audio.tracks.stop();
        setTimeout(() => this.page === 'about' && this.refresh(), 200);
        return;
      }
      // Playing a piece by hand switches the music style back to piano.
      if (this.ui.ctx.settings.musicStyle !== 'piano') this.ui.updateSetting('musicStyle', 'piano');
      this.audio?.playTrack(track);
      setTimeout(() => this.page === 'about' && this.refresh(), 400);
    };

    const tracks = TRACKS.map((t) =>
      h(
        'li',
        { class: `credit-track${playing === t ? ' is-playing' : ''}` },
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn credit-play',
            'aria-label': playing === t ? `Stop ${t.title}` : `Play ${t.title} by ${t.author}`,
            'data-focus-key': `play-${t.url}`,
            onClick: () => play(t),
          },
          icon(playing === t ? 'pause' : 'play', { size: 14 }),
        ),
        h(
          'span',
          { class: 'credit-text' },
          h('strong', null, t.title),
          h('span', null, `by ${t.author}`),
        ),
        link(t.source, 'OpenGameArt'),
      ),
    );

    return h(
      'div',
      { class: 'page page-about' },
      h(
        'section',
        { class: 'about-hero' },
        h('span', { class: 'about-logo' }, icon('logo', { size: 44 })),
        h(
          'div',
          null,
          h('h3', { class: 'about-name' }, 'Buildagon'),
          h(
            'p',
            null,
            'A cozy sandbox for raising islands on a hex grid. There are no goals and no timers, only the sea and whatever you feel like making.',
          ),
        ),
      ),
      h(
        'section',
        { class: 'settings-group about-group', 'aria-label': 'Music' },
        h('h3', { class: 'section-title' }, 'Music'),
        h(
          'p',
          { class: 'about-note' },
          'Every piece is dedicated to the public domain under ',
          link('https://creativecommons.org/publicdomain/zero/1.0/', 'CC0'),
          '. Thank you to these composers for sharing their work. Select a piece to play it now.',
        ),
        h('ul', { class: 'credit-list' }, tracks),
      ),
      h(
        'section',
        { class: 'settings-group about-group', 'aria-label': 'Made with' },
        h('h3', { class: 'section-title' }, 'Made with'),
        h(
          'ul',
          { class: 'credit-plain' },
          h('li', null, link('https://threejs.org', 'three.js'), ' for 3D rendering (MIT License)'),
          h('li', null, link('https://vite.dev', 'Vite'), ' for building and serving (MIT License)'),
          h(
            'li',
            null,
            link('https://fonts.google.com/specimen/Fredoka', 'Fredoka'),
            ' and ',
            link('https://fonts.google.com/specimen/Nunito', 'Nunito'),
            ' fonts (SIL Open Font License)',
          ),
          h('li', null, 'Apart from the music, every model, sound effect, and ambient sound is generated in code.'),
        ),
      ),
    );
  }

  // ---- Save ---------------------------------------------------------------

  renderSave() {
    const saves = this.saves;
    const current = saves?.current ?? null;
    const inputId = uniqueId('save-name');
    const input = h('input', {
      id: inputId,
      class: 'field',
      type: 'text',
      maxlength: '40',
      placeholder: 'My cozy island',
      autocomplete: 'off',
      spellcheck: 'false',
      value: current?.name ?? '',
      'data-focus-key': 'save-name',
    });
    const saveNew = () => {
      const name = input.value.trim() || defaultName();
      if (saves?.save(null, name)) this.saved(name);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNew();
      }
    });

    const form = h(
      'div',
      { class: 'save-form' },
      h('label', { class: 'field-label', for: inputId }, 'World name'),
      h(
        'div',
        { class: 'field-row' },
        input,
        h(
          'button',
          { type: 'button', class: 'btn btn-primary', 'data-sound': 'none', 'data-focus-key': 'save-new', onClick: saveNew },
          icon('save', { size: 18 }),
          'Save as new',
        ),
      ),
    );

    const list = (saves?.list() ?? []).filter((s) => !s.autosave);
    const rows = list.map((s) =>
      this.saveRow(
        s,
        [
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              'data-sound': 'none',
              'data-focus-key': `over-${s.id}`,
              'aria-label': `Overwrite ${s.name}`,
              onClick: () => {
                if (saves.save(s.id, s.name)) this.saved(s.name);
              },
            },
            icon('refresh', { size: 16 }),
            'Overwrite',
          ),
          this.deleteButton(s),
        ],
        current?.id === s.id,
      ),
    );

    return h(
      'div',
      { class: 'page page-save' },
      form,
      h('h3', { class: 'section-title' }, 'Your saves'),
      rows.length
        ? h('ul', { class: 'save-list', 'aria-label': 'Your saves' }, rows)
        : h('p', { class: 'empty-note' }, 'No saves yet. Name your world, then select Save as new.'),
      h(
        'div',
        { class: 'page-foot' },
        h(
          'div',
          { class: 'foot-text' },
          h('strong', null, 'Keep a copy'),
          h('span', null, 'Download this world as a .json file to back it up or share it.'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              const name = input.value.trim() || current?.name || 'My island';
              if (saves?.exportFile(name)) this.ui.toast(`Exported “${name}”`);
              else this.failed(saves?.lastError ?? "Couldn't export this world.");
            },
          },
          icon('download', { size: 18 }),
          'Export to file',
        ),
      ),
    );
  }

  saved(name) {
    this.audio?.play('save');
    this.ui.toast(`Saved “${name}”`);
    this.refresh();
  }

  failed(message) {
    this.audio?.play('error');
    this.ui.toast(message, 'error');
  }

  saveRow(s, actions, current = false) {
    const name = s.autosave ? 'Autosave' : s.name || 'Untitled';
    return h(
      'li',
      { class: `save-row${current ? ' is-current' : ''}` },
      h('div', { class: 'save-thumb' }, s.thumb ? h('img', { src: s.thumb, alt: '' }) : icon('island', { size: 28 })),
      h(
        'div',
        { class: 'save-info' },
        h(
          'span',
          { class: 'save-name' },
          h('span', { class: 'save-name-text' }, name),
          s.autosave ? h('span', { class: 'badge' }, 'Automatic') : null,
          current ? h('span', { class: 'badge badge-sage' }, 'Current') : null,
        ),
        h('span', { class: 'save-date' }, formatDate(s.date)),
      ),
      h('div', { class: 'save-actions' }, actions),
    );
  }

  deleteButton(s) {
    const label = h('span', null, 'Delete');
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-small btn-quiet',
        'aria-label': `Delete ${s.name}`,
        'data-focus-key': `del-${s.id}`,
      },
      icon('trash', { size: 16 }),
      label,
    );
    let armed = false;
    let timer = 0;
    const disarm = () => {
      armed = false;
      btn.classList.remove('btn-danger');
      label.textContent = 'Delete';
      btn.setAttribute('aria-label', `Delete ${s.name}`);
    };
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.classList.add('btn-danger');
        label.textContent = 'Confirm';
        btn.setAttribute('aria-label', `Select again to delete ${s.name}`);
        timer = setTimeout(disarm, 4000);
        return;
      }
      clearTimeout(timer);
      this.saves?.remove(s.id);
      this.ui.toast(`Deleted “${s.name}”`);
      this.refresh();
    });
    btn.addEventListener('blur', () => {
      if (armed) {
        clearTimeout(timer);
        disarm();
      }
    });
    return btn;
  }

  // ---- Load ---------------------------------------------------------------

  renderLoad() {
    const saves = this.saves;
    const list = saves?.list() ?? [];
    const rows = list.map((s) =>
      this.saveRow(
        s,
        [
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small btn-primary',
              'data-sound': 'none',
              'data-focus-key': `load-${s.id}`,
              'aria-label': `Load ${s.autosave ? 'the autosave' : s.name}`,
              onClick: () => this.load(s),
            },
            icon('folder', { size: 16 }),
            'Load',
          ),
          s.autosave ? null : this.deleteButton(s),
        ],
        !s.autosave && saves?.current?.id === s.id,
      ),
    );

    const fileInput = h('input', {
      type: 'file',
      accept: '.json,application/json',
      class: 'visually-hidden',
      tabindex: '-1',
      'aria-hidden': 'true',
    });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      const ok = await saves?.importFile(file);
      if (!ok) {
        this.failed(saves?.lastError ?? "That file isn't a Buildagon world.");
        return;
      }
      this.loaded(`Imported “${saves.current?.name ?? file.name}”`);
    });

    return h(
      'div',
      { class: 'page page-load' },
      rows.length
        ? h('ul', { class: 'save-list', 'aria-label': 'Saved worlds' }, rows)
        : h('p', { class: 'empty-note' }, 'No saves yet. Your world also saves itself every minute while you play.'),
      h(
        'div',
        { class: 'page-foot' },
        h(
          'div',
          { class: 'foot-text' },
          h('strong', null, 'Open a world file'),
          h('span', null, 'Load a .json world that you exported earlier or that someone shared with you.'),
        ),
        h('button', { type: 'button', class: 'btn', onClick: () => fileInput.click() }, icon('upload', { size: 18 }), 'Import from file'),
        fileInput,
      ),
    );
  }

  load(s) {
    if (!this.saves?.load(s.id)) {
      this.failed(this.saves?.lastError ?? "Couldn't load that save. It might be damaged.");
      return;
    }
    this.loaded(s.autosave ? 'Loaded the autosave' : `Loaded “${s.name}”`);
  }

  loaded(message) {
    this.ui.ctx.build?.clearHistory?.();
    this.audio?.play('load');
    this.ui.toast(message);
    this.ui.closeAll({ silent: true });
  }

  // ---- New world ------------------------------------------------------------

  renderNew() {
    const options = [
      {
        kind: 'water',
        title: 'Open water',
        text: 'Nothing but calm sea. Click the water to raise your first tile.',
        icon: 'water',
      },
      {
        kind: 'starter',
        title: 'Starter island',
        text: 'Rolling hills, a small lake, and a few trees to build around.',
        icon: 'island',
      },
      {
        kind: 'empty',
        title: 'Empty island',
        text: 'A small, flat island with plenty of room for your own ideas.',
        icon: 'logo',
      },
    ];

    const confirm = h('div', { class: 'confirm', hidden: true });
    const cards = options.map((o) =>
      h(
        'button',
        { type: 'button', class: `world-card world-${o.kind}`, 'data-focus-key': `new-${o.kind}`, onClick: () => ask(o) },
        h('span', { class: 'world-art' }, icon(o.icon, { size: 40 })),
        h('span', { class: 'world-title' }, o.title),
        h('span', { class: 'world-text' }, o.text),
      ),
    );

    const ask = (o) => {
      confirm.hidden = false;
      const start = h(
        'button',
        { type: 'button', class: 'btn btn-warm', 'data-sound': 'none', onClick: () => this.startNew(o.kind) },
        icon('sparkle', { size: 16 }),
        'Start new world',
      );
      confirm.replaceChildren(
        h('p', null, h('strong', null, `Start a new ${o.title.toLowerCase()}?`), ' This replaces your current world. Save first if you want to keep it.'),
        h(
          'div',
          { class: 'confirm-actions' },
          start,
          h('button', { type: 'button', class: 'btn', onClick: () => this.show('save') }, icon('save', { size: 16 }), 'Save first'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-quiet',
              onClick: () => {
                confirm.hidden = true;
                this.content.querySelector(`[data-focus-key="new-${o.kind}"]`)?.focus();
              },
            },
            'Cancel',
          ),
        ),
      );
      replay(confirm, 'page-in');
      start.focus();
    };

    return h(
      'div',
      { class: 'page page-new' },
      h('p', { class: 'page-intro' }, 'Pick a place to start. A new world replaces the one you have open now.'),
      h('div', { class: 'world-cards' }, cards),
      confirm,
    );
  }

  startNew(kind) {
    this.ui.emit('newWorld', kind);
    this.audio?.play('load');
    const messages = {
      water: 'Calm open water is ready',
      starter: 'A new starter island is ready',
      empty: 'A fresh, empty island is ready',
    };
    this.ui.toast(messages[kind] ?? messages.water);
    this.ui.closeAll({ silent: true });
  }

  // ---- Settings -------------------------------------------------------------

  buildSettings() {
    const groups = SETTINGS.map((g) =>
      h(
        'section',
        { class: 'settings-group', 'aria-label': g.title },
        h('h3', { class: 'section-title' }, g.title),
        g.items.map((item) => this.settingRow(item)),
      ),
    );
    return h(
      'div',
      { class: 'page page-settings' },
      groups,
      h(
        'div',
        { class: 'page-foot' },
        h('div', { class: 'foot-text' }, h('strong', null, 'Restore defaults'), h('span', null, 'Put every setting back the way it started.')),
        h('button', { type: 'button', class: 'btn', onClick: () => this.resetSettings() }, icon('refresh', { size: 18 }), 'Restore defaults'),
      ),
    );
  }

  settingRow(item) {
    const settings = this.ui.ctx.settings;
    const id = uniqueId(item.key);
    const labelId = `${id}-label`;
    const label = h(
      'label',
      { class: 'setting-label', id: labelId, for: id },
      item.label,
      item.help ? h('span', { class: 'setting-help' }, item.help) : null,
    );

    if (item.type === 'range' || item.type === 'time') {
      const isTime = item.type === 'time';
      const min = isTime ? 0 : item.min;
      const max = isTime ? 24 : item.max;
      const step = isTime ? 0.25 : item.step;
      const format = isTime ? formatClock : item.format;
      const out = h('output', { class: 'setting-value', for: id });
      const input = h('input', { id, class: 'range', type: 'range', min, max, step });
      const show = (v) => {
        out.textContent = format(v);
        setFill(input);
      };
      const sync = () => {
        const v = isTime ? this.time : Number(settings[item.key]);
        input.value = String(v);
        show(Number(input.value));
      };
      input.addEventListener('input', () => {
        const v = Number(input.value);
        show(v);
        if (isTime) {
          this.time = v;
          this.ui.emit('timeOfDay', v);
        } else if (!item.heavy) {
          this.ui.updateSetting(item.key, v, { commit: false });
        }
      });
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (isTime) this.timeDragging = false;
        else this.ui.updateSetting(item.key, v);
        if (item.preview) this.audio?.play(item.preview);
      });
      if (isTime) {
        input.addEventListener('pointerdown', () => (this.timeDragging = true));
        input.addEventListener('pointerup', () => (this.timeDragging = false));
        input.addEventListener('blur', () => (this.timeDragging = false));
        this.timeSync = sync;
      }
      this.syncers.push(sync);
      return h('div', { class: 'setting' }, label, input, out);
    }

    if (item.type === 'switch') {
      const btn = h('button', {
        id,
        type: 'button',
        class: 'switch',
        role: 'switch',
        'aria-checked': 'false',
        onClick: () => {
          this.ui.updateSetting(item.key, !settings[item.key]);
          sync();
        },
      });
      const state = h('span', { class: 'setting-value', 'aria-hidden': 'true' });
      const sync = () => {
        const on = !!settings[item.key];
        btn.setAttribute('aria-checked', String(on));
        state.textContent = on ? 'On' : 'Off';
      };
      this.syncers.push(sync);
      return h('div', { class: 'setting' }, label, h('div', { class: 'setting-control' }, btn), state);
    }

    // Segmented radio group.
    const buttons = item.options.map(([value, text]) =>
      h('button', {
        type: 'button',
        class: 'seg',
        role: 'radio',
        'aria-checked': 'false',
        'data-value': value,
        onClick: () => choose(value),
      }, text),
    );
    const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': labelId, id }, buttons);
    const sync = () => {
      buttons.forEach((b) => {
        const on = b.dataset.value === settings[item.key];
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
    };
    const choose = (value, focus = false) => {
      this.ui.updateSetting(item.key, value);
      sync();
      if (focus) buttons.find((b) => b.dataset.value === value)?.focus();
    };
    group.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const values = item.options.map(([v]) => v);
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      const i = Math.max(0, values.indexOf(settings[item.key]));
      choose(values[(i + dir + values.length) % values.length], true);
      this.audio?.play('ui_click');
    });
    this.syncers.push(sync);
    // Labels can't point at a radiogroup, so the label only names it.
    label.removeAttribute('for');
    return h('div', { class: 'setting' }, label, h('div', { class: 'setting-control' }, group), h('span'));
  }

  syncSettings() {
    for (const sync of this.syncers) sync();
  }

  syncTime(hours) {
    this.time = hours;
    if (!this.isOpen || this.page !== 'settings' || this.timeDragging) return;
    this.timeSync?.();
  }

  resetSettings() {
    const settings = this.ui.ctx.settings;
    Object.assign(settings, DEFAULT_SETTINGS);
    this.ui.updateSetting('showHints', settings.showHints);
    this.syncSettings();
    this.ui.toast('Settings restored to their defaults');
  }
}

function defaultName() {
  const d = new Date();
  return `Island, ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
