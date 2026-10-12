// Base for centered dialog panels (build menu, system menu, help). The UI class
// decides which one is open; a modal only shows, hides, and keeps focus inside.

import { h, trapFocus } from './dom.js';
import { icon } from './icons.js';

export class Modal {
  constructor(ui, { className = '', layerClass = '', labelledBy } = {}) {
    this.ui = ui;
    this.isOpen = false;
    this.panel = h('section', {
      class: `panel ${className}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': labelledBy,
      tabindex: '-1',
    });
    this.layer = h('div', { class: `layer ${layerClass}`.trim() }, this.panel);
    this.panel.addEventListener('keydown', (e) => trapFocus(e, this.panel));
  }

  setOpen(open) {
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.layer.classList.toggle('is-open', open);
    if (open) {
      this.onOpen();
      (this.focusTarget() ?? this.panel).focus({ preventScroll: true });
    } else {
      this.onClose();
    }
  }

  onOpen() {}
  onClose() {}
  focusTarget() {
    return null;
  }
}

// Shared panel header: icon badge, title, optional subtitle, extra content, close button.
export function panelHeader({ id, title, iconName, subtitle, extra, onClose, closeLabel = 'Close' }) {
  return h(
    'header',
    { class: 'panel-head' },
    h(
      'div',
      { class: 'panel-title' },
      h('span', { class: 'title-badge' }, icon(iconName, { size: 22 })),
      h('div', null, h('h2', { id }, title), subtitle ? h('p', { class: 'panel-sub' }, subtitle) : null),
    ),
    extra ?? null,
    h(
      'button',
      { type: 'button', class: 'icon-btn close-btn', 'aria-label': closeLabel, 'data-sound': 'none', onClick: onClose },
      icon('close', { size: 18 }),
    ),
  );
}
