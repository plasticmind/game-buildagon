// Nature journal (J): every animal you've found, with hints for the common ones
// you haven't and riddles for the rare ones. Unseen animals show as silhouettes.
// A golden sighting earns a badge and a golden portrait. Golden animals are a
// surprise, so nothing here mentions them until you find one.

import { h } from './dom.js';
import { icon } from './icons.js';
import { Modal, panelHeader } from './Modal.js';
import { getModelThumbnail } from './thumbnails.js';
import { JOURNAL } from '../life/Journal.js';
import { mulberry32 } from '../core/random.js';
import * as models from '../life/models.js';

// A portrait builder per entry. Each call returns a fresh model.
const PORTRAITS = {
  frog: (rng) => models.frogModel(rng),
  duck: (rng) => models.duckModel(rng, 'drake'),
  duckling: (rng) => models.ducklingModel(rng),
  swan: (rng) => models.swanModel(rng),
  koi: (rng) => models.fishModel(rng, models.KOI_LOOKS[0]),
  fish: (rng) => models.fishModel(rng, models.SILVER),
  butterfly: (rng) => models.butterflyModel(rng),
  songbird: (rng) => models.songbirdModel(rng),
  gull: (rng) => models.gullModel(rng),
  rabbit: (rng) => models.rabbitModel(rng),
  cat: (rng) => models.catModel(rng),
  fairy: (rng) => models.fairyModel(rng),
  owl: (rng) => models.owlModel(rng),
  whale: (rng) => models.whaleModel(rng),
  fox: (rng) => models.foxModel(rng),
  bear: (rng) => models.bearModel(rng),
  dragon: (rng) => models.dragonModel(rng),
  turtle: (rng) => models.hatchlingModel(rng),
};

const SECTIONS = [
  { title: 'Visitors', rare: false },
  { title: 'Rare sightings', rare: true },
];

export class JournalPanel extends Modal {
  constructor(ui) {
    super(ui, { className: 'journal-panel', layerClass: 'layer-journal', labelledBy: 'journal-title' });
    this.journal = ui.ctx.journal;

    this.subtitle = h('p', { class: 'panel-sub' });
    const header = panelHeader({
      id: 'journal-title',
      title: 'Nature journal',
      iconName: 'book',
      onClose: () => ui.toggleJournal(false),
      closeLabel: 'Close the nature journal',
    });
    // panelHeader takes a fixed subtitle; this one changes as you find animals.
    header.querySelector('.panel-title h2').after(this.subtitle);

    this.body = h('div', { class: 'journal-body' });
    this.panel.append(header, this.body);

    this.journal?.on('discover', () => {
      if (this.isOpen) this.render();
    });
  }

  onOpen() {
    this.render();
    this.body.scrollTop = 0;
  }

  focusTarget() {
    return this.panel.querySelector('.close-btn');
  }

  render() {
    const journal = this.journal;
    if (!journal) return;
    const golden = JOURNAL.filter((e) => journal.seen[e.id]?.golden).length;
    this.subtitle.textContent =
      `${journal.found} of ${journal.total} found` + (golden ? `, ${golden} golden` : '') + '. Press J to close.';

    this.body.replaceChildren(
      ...SECTIONS.map(({ title, rare }) => {
        const entries = JOURNAL.filter((e) => !!e.rare === rare);
        const found = entries.filter((e) => journal.has(e.id)).length;
        const headId = `journal-${rare ? 'rare' : 'common'}`;
        return h(
          'section',
          { class: 'journal-section', 'aria-labelledby': headId },
          h(
            'div',
            { class: 'journal-section-head' },
            h('h3', { id: headId }, title),
            h('span', null, `${found} of ${entries.length}`),
          ),
          h('ul', { class: 'journal-grid' }, entries.map((e) => this.card(e))),
        );
      }),
      this.footer(),
    );
  }

  card(entry) {
    const rec = this.journal.seen[entry.id];
    const seen = !!rec;
    const golden = !!rec?.golden;
    const thumb = h('span', { class: 'thumb journal-thumb is-loading' }, h('img', { alt: '' }));
    this.portrait(thumb, entry.id, { seen, golden });

    let text;
    if (seen) {
      text = [
        h('p', { class: 'journal-about' }, entry.about),
        h('p', { class: 'journal-date' }, `First seen ${shortDate(rec.first)}`),
      ];
    } else if (entry.rare) {
      text = h('p', { class: 'journal-about journal-riddle' }, entry.hint);
    } else {
      text = h('p', { class: 'journal-about journal-try' }, h('span', { class: 'journal-try-label' }, 'Try: '), entry.hint);
    }

    const cls = ['journal-card', seen ? 'is-seen' : 'is-unseen', entry.rare ? 'is-rare' : '', golden ? 'is-golden' : ''];
    return h(
      'li',
      { class: cls.filter(Boolean).join(' ') },
      thumb,
      h(
        'div',
        { class: 'journal-text' },
        h(
          'p',
          { class: 'journal-name' },
          seen || !entry.rare ? entry.name : h('span', { 'aria-label': 'Not found yet' }, '???'),
          golden ? h('span', { class: 'journal-gold' }, icon('sparkle', { size: 11 }), 'Golden') : null,
        ),
        text,
      ),
    );
  }

  portrait(holder, id, { seen, golden }) {
    const make = PORTRAITS[id];
    if (!make) return;
    const variant = golden ? 'golden' : 'plain';
    const build = () => {
      const model = make(mulberry32(7));
      return golden ? models.gild(model) : model;
    };
    // Nearly side-on, so silhouettes read as the animal they are.
    const view = { azimuth: 62, elevation: 16 };
    getModelThumbnail(`journal:${id}:${variant}`, build, { silhouette: !seen, ...view }).then((url) => {
      holder.classList.remove('is-loading');
      const img = holder.querySelector('img');
      if (url) {
        img.src = url;
        holder.classList.add('is-loaded');
      }
    });
  }

  footer() {
    const label = h('span', null, 'Start a new journal');
    const btn = h('button', { type: 'button', class: 'btn btn-small btn-quiet' }, icon('refresh', { size: 16 }), label);
    let armed = false;
    let timer = 0;
    const disarm = () => {
      armed = false;
      btn.classList.remove('btn-danger');
      label.textContent = 'Start a new journal';
      btn.removeAttribute('aria-label');
    };
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        btn.classList.add('btn-danger');
        label.textContent = 'Erase every sighting?';
        btn.setAttribute('aria-label', 'Select again to erase every sighting');
        timer = setTimeout(disarm, 4000);
        return;
      }
      clearTimeout(timer);
      this.journal.reset();
      this.ui.toast('Your journal is blank again. Happy spotting.');
      this.render();
      this.focusTarget()?.focus();
    });
    btn.addEventListener('blur', () => {
      if (armed) {
        clearTimeout(timer);
        disarm();
      }
    });
    return h('footer', { class: 'journal-foot' }, btn);
  }
}

// "Oct 12", or "Oct 12, 2025" for another year.
function shortDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
