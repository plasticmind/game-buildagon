// Inline SVG icons on a 24px grid. Stroke icons inherit currentColor.

const HEX = 'M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z';

const PATHS = {
  logo: `<path d="${HEX}" fill="currentColor" opacity=".16"/><path d="${HEX}"/><path d="M12 17.5v-5.5"/><path d="M12 12c0-2.4 1.7-4 4-4 0 2.4-1.7 4-4 4z" fill="currentColor"/><path d="M12 13.6c0-1.9-1.4-3.2-3.3-3.2 0 1.9 1.4 3.2 3.3 3.2z" fill="currentColor"/>`,
  sun: '<circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  moon: '<path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z" fill="currentColor"/>',
  build: `<path d="${HEX}"/><path d="M12 8.5v7M8.5 12h7"/>`,
  destroy: `<path d="${HEX}"/><path d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4"/>`,
  snap: `<path d="${HEX}"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
  free: `<path d="${HEX}" stroke-dasharray="2.4 2.6"/><path d="M12 9.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor"/>`,
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  scale: '<path d="M4.5 19.5l6-6M4.5 15v4.5H9M19.5 4.5l-6 6M19.5 9V4.5H15"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  chevronLeft: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  save: '<path d="M5 4.5h10.5l3.5 3.5v11.5H5z"/><path d="M8.5 4.5v4.5h6V4.5M8.5 19.5v-5.5h7v5.5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  island: '<path d="M3 18.5c2 1.4 4 1.4 6 0s4-1.4 6 0 4 1.4 6 0"/><path d="M5.5 15.5a6.5 6.5 0 0 1 13 0"/><path d="M12 9V5.5M12 5.5c-1.8 0-3 .8-3.6 2M12 5.5c1.8 0 3 .8 3.6 2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="3"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.2h8"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 19.5h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 13.1-5L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13.1 5L4.5 15M4.5 19.5V15H9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5"/><path d="M12 17h.01"/>',
  alert: '<path d="M12 7v6.5"/><path d="M12 17h.01"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  book: '<path d="M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2z"/><path d="M12 6.5v13"/>',
  sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z" fill="currentColor"/>',
  // Categories.
  terrain: '<path d="M3 19.5l6-10 4 6 2-3 6 7z"/>',
  water: '<path d="M3 9.5c2 1.4 4 1.4 6 0s4-1.4 6 0 4 1.4 6 0M3 15c2 1.4 4 1.4 6 0s4-1.4 6 0 4 1.4 6 0"/>',
  trees: '<path d="M12 3l6 8h-3l4 5H5l4-5H6z"/><path d="M12 16v5"/>',
  flora: '<circle cx="12" cy="5.6" r="2"/><circle cx="14.6" cy="8.1" r="2"/><circle cx="12" cy="10.6" r="2"/><circle cx="9.4" cy="8.1" r="2"/><path d="M12 12.6V21M12 18.5c-2-.2-3.5-1.6-3.9-3.4 2 .1 3.5 1.4 3.9 3.4z"/>',
  rocks: '<path d="M3 18.5l3-6 4.2-2.2 3 2 3.3-3 4.5 9.2z"/><path d="M10.2 10.3l1.3 3.2"/>',
  structures: '<path d="M4 11l8-6.5 8 6.5M6 9.5V19.5h12V9.5M10 19.5v-5h4v5"/>',
  furniture: '<path d="M6.5 10.5V7a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3.5"/><path d="M4 12a1.5 1.5 0 0 1 3 0v2h10v-2a1.5 1.5 0 0 1 3 0v5H4z"/><path d="M6 17v2.5M18 17v2.5"/>',
  props: '<path d="M10 4h4M9 7h6l1 10H8zM12 4V2.5M8 20h8M12 10v4"/>',
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, { size = 20, className = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}
