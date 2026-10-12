// Small DOM helpers so the UI can be built without a framework.

import { getThumbnail, peekThumbnail } from './thumbnails.js';

// h('button', { class: 'btn', onClick: fn, 'aria-label': 'Close' }, child, 'text')
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  return append(el, children);
}

export function setProps(el, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function kbd(label, extra = '') {
  return h('kbd', { class: `key ${extra}`.trim() }, label);
}

let uid = 0;
export function uniqueId(prefix = 'ui') {
  uid += 1;
  return `${prefix}-${uid}`;
}

// Restart a one-shot CSS animation class.
export function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Show an item thumbnail inside `holder` (which contains an <img>). Falls back to
// the item's initial when WebGL can't render it.
export function showThumb(holder, itemId, variant = 0, name = '') {
  const img = holder.querySelector('img');
  if (!img) return;
  if (!itemId) {
    holder.dataset.key = '';
    holder.dataset.item = '';
    holder.classList.remove('is-loaded', 'is-loading', 'is-fallback');
    img.removeAttribute('src');
    return;
  }
  const key = `${itemId}:${variant}`;
  if (holder.dataset.key === key) return;
  const sameItem = holder.dataset.item === itemId;
  holder.dataset.key = key;
  holder.dataset.item = itemId;
  holder.dataset.fallback = (name || itemId).trim().charAt(0).toUpperCase();

  const apply = (url) => {
    if (holder.dataset.key !== key) return;
    holder.classList.remove('is-loading');
    if (url) {
      img.src = url;
      holder.classList.add('is-loaded');
      holder.classList.remove('is-fallback');
    } else {
      img.removeAttribute('src');
      holder.classList.add('is-fallback');
      holder.classList.remove('is-loaded');
    }
  };

  const cached = peekThumbnail(itemId, variant);
  if (cached) {
    apply(cached);
    return;
  }
  // Keep the previous picture while a new variant of the same item renders, to
  // avoid a flash. A different item clears it, so the slot never shows the wrong one.
  if (!sameItem) {
    img.removeAttribute('src');
    holder.classList.remove('is-loaded');
  }
  holder.classList.add('is-loading');
  getThumbnail(itemId, variant).then(apply);
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

// Keep Tab and Shift+Tab inside a dialog.
export function trapFocus(e, container) {
  if (e.key !== 'Tab') return;
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

// "Today, 14:32" / "Yesterday, 09:10" / "Oct 3, 18:45"
export function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  return `${date}, ${time}`;
}

// 9.5 → "09:30"
export function formatClock(hours) {
  const total = Math.floor((((hours % 24) + 24) % 24) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
