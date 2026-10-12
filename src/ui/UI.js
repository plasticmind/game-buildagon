// Buildagon's HTML overlay: HUD, build menu, system menu, help, toasts, and the
// first-run welcome card. #ui ignores the pointer; interactive panels opt back in.
//
// Events:
//   'settings'   (settings)  after the shared settings object changes
//   'newWorld'   ('water' | 'starter' | 'empty')
//   'menu'       (open)      whenever a menu opens or closes; open = any menu open
//   'timeOfDay'  (hours)

import { Emitter } from '../core/events.js';
import { h, replay } from './dom.js';
import { icon } from './icons.js';
import { Hud } from './Hud.js';
import { BuildMenu } from './BuildMenu.js';
import { SystemMenu } from './SystemMenu.js';
import { Modal, panelHeader } from './Modal.js';
import { renderControls, renderKeys, renderNatureGuide } from './controls.js';

const WELCOME_KEY = 'buildagon.welcomed.v1';
const TOAST_MS = 2800;
const MAX_TOASTS = 3;

export class UI extends Emitter {
  constructor(root, ctx) {
    super();
    this.root = root;
    this.ctx = ctx;
    this.audio = ctx.audio;
    this.toasts = [];
    this.hovered = null;
    this.hoverAt = 0;
    this.settingsTimer = 0;

    root.classList.add('ui-root');

    this.hud = new Hud(this);
    this.scrim = h('div', { class: 'scrim', 'aria-hidden': 'true', onClick: () => this.closeAll() });
    this.buildMenu = new BuildMenu(this);
    this.systemMenu = new SystemMenu(this);
    this.help = this.createHelp();
    this.toastList = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    this.welcome = this.createWelcome();
    this.emptyPrompt = this.createEmptyPrompt();
    this.menus = [this.buildMenu, this.systemMenu, this.help];

    root.append(this.hud.el, this.emptyPrompt, this.scrim, this.buildMenu.layer, this.systemMenu.layer, this.help.layer, this.toastList);
    if (this.welcome) root.append(this.welcome);

    ctx.hotbars?.on('change', () => this.onHotbars());
    ctx.saves?.on?.('error', (msg) => {
      this.audio?.play('error');
      this.toast(msg, 'error');
    });

    this.bindSounds();
    this.bindFieldKeys();

    this.onHotbars();
    const initial = ctx.build?.getState?.();
    if (initial) this.setState(initial);
  }

  // ---- Public API -----------------------------------------------------------

  get anyMenuOpen() {
    return this.menus.some((m) => m.isOpen);
  }

  // The build controller sends a complete state on every change.
  setState(state) {
    this.hud.setState(state);
  }

  // Show the first-tile prompt while the world has no land at all.
  setEmptyWorld(empty) {
    this.emptyPrompt.hidden = !empty;
  }

  setTime(hours) {
    this.hud.setTime(hours);
    this.systemMenu.syncTime(hours);
  }

  toast(message, tone = 'info') {
    if (!message) return;
    const text = String(message);
    const last = this.toasts[this.toasts.length - 1];
    if (last && last.text === text && !last.leaving) {
      clearTimeout(last.timer);
      last.timer = setTimeout(() => this.dropToast(last), TOAST_MS);
      replay(last.el, 'is-bump');
      return;
    }
    const el = h(
      'div',
      { class: `toast toast-${tone}` },
      h('span', { class: 'toast-icon' }, icon(tone === 'error' ? 'alert' : 'sparkle', { size: 14 })),
      h('span', null, text),
    );
    const t = { el, text, leaving: false, timer: 0 };
    t.timer = setTimeout(() => this.dropToast(t), tone === 'error' ? TOAST_MS * 1.6 : TOAST_MS);
    this.toasts.push(t);
    this.toastList.append(el);
    const live = this.toasts.filter((x) => !x.leaving);
    if (live.length > MAX_TOASTS) this.dropToast(live[0]);
  }

  toggleBuildMenu(force) {
    this.toggleMenu(this.buildMenu, force);
  }

  toggleSystemMenu(force) {
    this.toggleMenu(this.systemMenu, force);
  }

  toggleHelp(force) {
    this.toggleMenu(this.help, force);
  }

  toggleHud(force) {
    const hidden = this.hud.el.classList.contains('is-hidden');
    const visible = force ?? hidden;
    if (visible === !hidden) return;
    this.hud.el.classList.toggle('is-hidden', !visible);
    this.root.classList.toggle('hud-hidden', !visible);
    if (!visible) this.toast('HUD hidden. Press P to bring it back.');
  }

  closeAll({ silent = false } = {}) {
    let closed = false;
    for (const m of this.menus) {
      if (m.isOpen) {
        m.setOpen(false);
        closed = true;
      }
    }
    if (this.welcome?.isConnected && !this.welcome.classList.contains('is-leaving')) {
      this.dismissWelcome({ silent: true });
      closed = true;
    }
    if (closed) {
      if (!silent) this.audio?.play('ui_close');
      this.syncMenus();
    }
    return closed;
  }

  // ---- Helpers used by the panels -------------------------------------------

  // The variant to show for an item: whatever the build controller last used.
  variantFor(itemId) {
    return this.ctx.build.variantFor(itemId);
  }

  // Change one setting. Heavy changes commit right away; slider drags are throttled.
  updateSetting(key, value, { commit = true } = {}) {
    const settings = this.ctx.settings;
    settings[key] = value;
    if (/Volume$/.test(key)) this.audio?.applySettings?.(settings);
    this.hud.setHintsVisible(settings.showHints !== false);
    this.hud.setPaused(!!settings.timePaused);
    if (commit) this.emitSettings();
    else if (!this.settingsTimer) this.settingsTimer = setTimeout(() => this.emitSettings(), 120);
  }

  emitSettings() {
    clearTimeout(this.settingsTimer);
    this.settingsTimer = 0;
    this.emit('settings', this.ctx.settings);
  }

  setDragging(on) {
    this.root.classList.toggle('is-dragging', on);
  }

  // ---- Internals ------------------------------------------------------------

  toggleMenu(menu, force) {
    const open = force ?? !menu.isOpen;
    if (open === menu.isOpen) return;
    if (open) {
      for (const m of this.menus) if (m !== menu && m.isOpen) m.setOpen(false);
      if (document.pointerLockElement) document.exitPointerLock?.();
      menu.setOpen(true);
      this.audio?.play('ui_open');
    } else {
      menu.setOpen(false);
      this.audio?.play('ui_close');
    }
    this.syncMenus();
  }

  syncMenus() {
    const open = this.anyMenuOpen;
    this.root.classList.toggle('has-menu', open);
    this.root.classList.toggle('build-open', this.buildMenu.isOpen);
    if (!open && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.emit('menu', open);
  }

  onHotbars() {
    this.hud.renderHotbar();
    if (this.buildMenu.isOpen) this.buildMenu.refreshBadges();
  }

  dropToast(t) {
    if (t.leaving) return;
    t.leaving = true;
    clearTimeout(t.timer);
    t.el.classList.add('is-leaving');
    setTimeout(() => {
      t.el.remove();
      this.toasts = this.toasts.filter((x) => x !== t);
    }, 260);
  }

  // Click and hover sounds for every button. A button can pick its own sound with
  // data-sound="name", or opt out with data-sound="none".
  bindSounds() {
    const root = this.root;
    root.addEventListener('pointerdown', () => this.audio?.unlock?.());
    root.addEventListener('click', (e) => {
      const btn = e.target.closest?.('button');
      if (!btn || !root.contains(btn)) return;
      const sound = btn.dataset.sound ?? 'ui_click';
      if (sound !== 'none') this.audio?.play(sound);
      // A mouse click shouldn't leave focus on a HUD button, or Space would press it again.
      if (e.detail > 0 && btn.closest('.hud')) btn.blur();
    });
    root.addEventListener('pointerover', (e) => {
      const el = e.target.closest?.('button, .range');
      if (el === this.hovered) return;
      this.hovered = el;
      if (!el || el.disabled) return;
      const now = performance.now();
      if (now - this.hoverAt < 70) return;
      this.hoverAt = now;
      this.audio?.play('ui_hover');
    });
  }

  // Text fields swallow game keys already (main.js ignores them), so Esc needs a
  // local handler there.
  bindFieldKeys() {
    this.root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (t.type === 'search' && t.value) {
        t.value = '';
        t.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      t.blur();
      this.closeAll();
    });
  }

  createHelp() {
    const help = new Modal(this, { className: 'help-panel', layerClass: 'layer-help', labelledBy: 'help-title' });
    help.panel.append(
      panelHeader({
        id: 'help-title',
        title: 'Controls',
        iconName: 'keyboard',
        subtitle: 'Everything you can do, and who moves in when you build. Press F1 or ? to close.',
        onClose: () => this.toggleHelp(false),
        closeLabel: 'Close controls',
      }),
      h('div', { class: 'help-body' }, renderControls(), renderNatureGuide()),
    );
    help.focusTarget = () => help.panel.querySelector('.close-btn');
    return help;
  }

  createWelcome() {
    if (readFlag(WELCOME_KEY)) return null;
    const rows = [
      [[['W', 'A', 'S', 'D']], true, 'Fly around'],
      [[['Q'], ['E']], false, 'Go down, go up'],
      [[['Right drag']], false, 'Look around'],
      [[['Left click']], false, 'Place what you hold'],
      [[['C']], false, 'Open the build menu'],
      [[['F1']], false, 'See every control'],
    ];
    const close = () => this.dismissWelcome();
    return h(
      'aside',
      { class: 'welcome', 'aria-labelledby': 'welcome-title' },
      h(
        'div',
        { class: 'welcome-head' },
        h('span', { class: 'welcome-logo' }, icon('logo', { size: 30 })),
        h('h2', { id: 'welcome-title' }, 'Welcome to Buildagon'),
        h(
          'button',
          { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss the welcome card', 'data-sound': 'none', onClick: close },
          icon('close', { size: 16 }),
        ),
      ),
      h('p', { class: 'welcome-text' }, 'Raise an island from the open sea, one tile at a time. Here are the basics:'),
      h(
        'dl',
        { class: 'welcome-keys' },
        rows.map(([keys, seq, label]) =>
          h('div', { class: 'controls-row' }, h('dt', { class: 'controls-keys' }, renderKeys(keys, { seq })), h('dd', null, label)),
        ),
      ),
      h('button', { type: 'button', class: 'btn btn-primary btn-wide', 'data-sound': 'none', onClick: close }, 'Start building'),
    );
  }

  createEmptyPrompt() {
    const spawn = () => {
      this.emit('newWorld', 'starter');
      this.audio?.play('load');
      this.toast('A starter island rose from the sea');
    };
    return h(
      'aside',
      { class: 'empty-prompt', hidden: true, 'aria-label': 'Getting started' },
      h('span', { class: 'empty-prompt-icon' }, icon('water', { size: 20 })),
      h('span', { class: 'empty-prompt-text' }, 'Click the water to place your first tile.'),
      h(
        'button',
        { type: 'button', class: 'btn btn-primary btn-small', onClick: spawn },
        icon('island', { size: 16 }),
        'Spawn a starter island',
      ),
    );
  }

  dismissWelcome({ silent = false } = {}) {
    const el = this.welcome;
    if (!el || el.classList.contains('is-leaving')) return;
    writeFlag(WELCOME_KEY);
    el.classList.add('is-leaving');
    if (!silent) this.audio?.play('ui_close');
    setTimeout(() => el.remove(), 320);
  }
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage can be unavailable; the card shows again next time.
  }
}
