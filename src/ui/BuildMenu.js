// Build menu (C): category tabs, a search field, and a grid of item cards.
// Click a card to hold the item, or drag it onto a hotbar slot.

import { h, showThumb, uniqueId } from './dom.js';
import { icon } from './icons.js';
import { Modal, panelHeader } from './Modal.js';
import { ITEM_TYPE } from './Hud.js';

export class BuildMenu extends Modal {
  constructor(ui) {
    super(ui, { className: 'build-menu', layerClass: 'layer-build', labelledBy: 'build-menu-title' });
    const { catalog } = ui.ctx;
    this.catalog = catalog;
    this.categories = catalog?.CATEGORIES ?? [];
    this.items = catalog?.ITEMS ?? [];
    this.category = this.categories[0]?.id ?? null;
    this.query = '';
    this.cards = new Map();
    this.tabs = new Map();

    const gridId = uniqueId('build-grid');
    const searchId = uniqueId('build-search');

    this.search = h('input', {
      id: searchId,
      class: 'field search-field',
      type: 'search',
      placeholder: 'Search items',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-controls': gridId,
    });
    this.search.addEventListener('input', () => {
      this.query = this.search.value;
      this.filter();
    });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = this.visible[0];
        if (first) this.pick(first.id);
      }
    });
    const searchWrap = h(
      'div',
      { class: 'search' },
      h('label', { class: 'visually-hidden', for: searchId }, 'Search items'),
      icon('search', { size: 18 }),
      this.search,
    );

    const header = panelHeader({
      id: 'build-menu-title',
      title: 'Build',
      iconName: 'build',
      subtitle: 'Choose an item to hold, or drag it onto a hotbar slot.',
      extra: searchWrap,
      onClose: () => ui.toggleBuildMenu(false),
      closeLabel: 'Close the build menu',
    });

    this.tablist = h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': 'Item categories' },
      this.categories.map((cat) => {
        const count = catalog.itemsInCategory(cat.id).length;
        const tab = h(
          'button',
          {
            type: 'button',
            class: 'tab',
            role: 'tab',
            id: uniqueId('tab'),
            'aria-controls': gridId,
            'aria-selected': 'false',
            tabindex: '-1',
            onClick: () => this.selectCategory(cat.id),
          },
          icon(cat.id, { size: 18 }),
          h('span', { class: 'tab-name' }, cat.name),
          h('span', { class: 'tab-count', 'aria-hidden': 'true' }, String(count)),
        );
        this.tabs.set(cat.id, tab);
        return tab;
      }),
    );
    this.tablist.addEventListener('keydown', (e) => this.onTabKey(e));

    this.grid = h('div', { class: 'item-grid', id: gridId, role: 'tabpanel' });
    for (const item of this.items) this.grid.append(this.buildCard(item));

    this.resultLabel = h('p', { class: 'result-label', role: 'status', 'aria-live': 'polite' });
    this.empty = h('p', { class: 'empty-note', hidden: true });
    this.body = h('div', { class: 'build-body' }, this.resultLabel, this.grid, this.empty);

    this.panel.append(header, this.tablist, this.body);
    this.visible = [];
  }

  buildCard(item) {
    const n = item.variants?.length ?? 1;
    const thumb = h('span', { class: 'thumb card-thumb' }, h('img', { alt: '', draggable: 'false' }));
    const badge = h('span', { class: 'card-slot', hidden: true });
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'card',
        draggable: 'true',
        'data-sound': 'hotbar',
        onClick: () => this.pick(item.id),
      },
      thumb,
      h('span', { class: 'card-name' }, item.name),
      h('span', { class: 'card-meta' }, n === 1 ? '1 variant' : `${n} variants`),
      badge,
    );

    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(ITEM_TYPE, item.id);
      e.dataTransfer.setData('text/plain', item.name);
      e.dataTransfer.effectAllowed = 'copy';
      const img = thumb.querySelector('img');
      if (img?.src) e.dataTransfer.setDragImage(img, 40, 40);
      this.ui.setDragging(true);
    });
    btn.addEventListener('dragend', () => this.ui.setDragging(false));

    this.cards.set(item.id, { btn, thumb, badge, item });
    return btn;
  }

  pick(id) {
    this.ui.ctx.hotbars?.pickItem(id);
    this.ui.toggleBuildMenu(false);
  }

  selectCategory(id, { focus = false } = {}) {
    this.category = id;
    if (this.query) {
      this.query = '';
      this.search.value = '';
    }
    this.filter();
    if (focus) this.tabs.get(id)?.focus();
    this.body.scrollTop = 0;
  }

  onTabKey(e) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // Keep arrow keys from rotating the blueprint while you browse tabs.
    e.preventDefault();
    e.stopPropagation();
    const ids = this.categories.map((c) => c.id);
    let i = ids.indexOf(this.category);
    if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
    else if (e.key === 'Home') i = 0;
    else i = ids.length - 1;
    this.selectCategory(ids[i], { focus: true });
    this.ui.ctx.audio?.play('ui_click');
  }

  filter() {
    const tokens = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const searching = tokens.length > 0;
    const catName = new Map(this.categories.map((c) => [c.id, c.name]));
    this.visible = [];

    for (const { btn, thumb, item } of this.cards.values()) {
      let show;
      if (searching) {
        const hay = [item.name, catName.get(item.category) ?? '', ...(item.variants ?? [])].join(' ').toLowerCase();
        show = tokens.every((t) => hay.includes(t));
      } else {
        show = item.category === this.category;
      }
      btn.hidden = !show;
      if (show) {
        this.visible.push(item);
        showThumb(thumb, item.id, this.ui.variantFor(item.id), item.name);
      }
    }

    for (const [id, tab] of this.tabs) {
      const selected = !searching && id === this.category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected || (searching && id === this.category) ? 0 : -1;
    }
    this.tablist.classList.toggle('is-searching', searching);
    const tab = this.tabs.get(this.category);
    if (tab) this.grid.setAttribute('aria-labelledby', tab.id);

    const q = this.query.trim();
    const n = this.visible.length;
    this.resultLabel.textContent = searching ? `${n} ${n === 1 ? 'match' : 'matches'} for “${q}”` : '';
    this.resultLabel.hidden = !searching;
    this.empty.hidden = n > 0;
    this.empty.textContent = searching ? `Nothing matches “${q}”. Try a different word.` : 'This category is empty.';
  }

  // Number badges show which items are already on the current hotbar preset.
  refreshBadges() {
    const hotbars = this.ui.ctx.hotbars;
    const slots = hotbars?.preset?.slots ?? [];
    const current = hotbars.currentItem;
    for (const [id, { btn, badge }] of this.cards) {
      const i = slots.indexOf(id);
      badge.hidden = i < 0;
      if (i >= 0) {
        badge.textContent = String(i + 1);
        badge.title = `In hotbar slot ${i + 1}`;
      }
      btn.classList.toggle('is-current', id === current);
      const name = this.cards.get(id).item.name;
      btn.setAttribute('aria-label', i >= 0 ? `${name}, in hotbar slot ${i + 1}` : name);
    }
  }

  onOpen() {
    this.query = '';
    this.search.value = '';
    // filter() refreshes thumbnails, so each card shows the variant you last used.
    this.filter();
    this.refreshBadges();
    this.body.scrollTop = 0;
  }

  focusTarget() {
    return this.tabs.get(this.category) ?? null;
  }
}
