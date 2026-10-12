// Saves worlds to localStorage, plus .json export and import.
//
// Payload: { version: 1, name, date, world, time, camera, hotbars, thumb }
//
// Storage layout (every access is wrapped; storage can be full or blocked):
//   buildagon.saves        index: [{ id, name, date }]
//   buildagon.save.<id>    the payload, without its thumbnail
//   buildagon.thumb.<id>   the thumbnail, a small JPEG data URL
// The autosave uses the id 'autosave' and appears in list() with autosave: true.
//
// Events: 'error' (message) when a save fails.
// `current` is the named save you last saved or loaded ({ id, name }), or null.
// `lastError` holds the message for the most recent failure.

import { Emitter } from '../core/events.js';
import { TERRAIN } from '../core/constants.js';
import { getItem } from '../catalog/catalog.js';

const VERSION = 1;
const PREFIX = 'buildagon.';
const INDEX_KEY = `${PREFIX}saves`;
const AUTOSAVE_ID = 'autosave';
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const AUTOSAVE_THUMB_EVERY = 3 * 60 * 1000;
const THUMB_W = 320;
const THUMB_H = 180;

const saveKey = (id) => `${PREFIX}save.${id}`;
const thumbKey = (id) => `${PREFIX}thumb.${id}`;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const MESSAGES = {
  quota: "Your browser's storage is full. Delete an old save or export this world to a file.",
  blocked: "Couldn't save. Your browser isn't allowing this page to store data.",
  read: "Couldn't read the world to save it.",
  damaged: "That save is damaged and can't be loaded.",
  missing: "That save doesn't exist anymore.",
  invalid: "That file isn't a Buildagon world.",
  tooBig: 'That file is too large to be a Buildagon world.',
  unreadable: "Couldn't read that file.",
};

export class SaveSystem extends Emitter {
  // autosave: false turns the autosave off entirely (no load, no writes), for
  // tabs that must never overwrite the player's world.
  constructor({ world, sky, pipeline, hotbars, cameraRig, autosave = true }) {
    super();
    this.ctx = { world, sky, pipeline, hotbars, cameraRig };
    this.autosaveEnabled = autosave;
    this.current = null;
    this.lastError = null;
    this.timer = 0;
    this.hooked = false;
    this.lastThumbAt = 0;
    this.lastAutosaveAt = 0;
    this.warnedAutosave = false;
  }

  // ---- Public API -----------------------------------------------------------

  list() {
    return this.readIndex()
      .map((m) => ({
        id: m.id,
        name: m.id === AUTOSAVE_ID ? 'Autosave' : m.name,
        date: m.date,
        thumb: read(thumbKey(m.id)),
        autosave: m.id === AUTOSAVE_ID,
      }))
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  }

  // Save to a slot. Pass null for a new slot. Returns the id, or null on failure.
  save(id, name) {
    const slot = typeof id === 'string' && id ? id : newId();
    const existing = this.readIndex().find((m) => m.id === slot);
    const clean = cleanName(name) || existing?.name || 'My island';
    const payload = this.payload(clean, { thumb: true });
    if (!payload || !this.write(slot, payload)) return null;
    if (slot !== AUTOSAVE_ID) this.current = { id: slot, name: clean };
    return slot;
  }

  load(id) {
    const raw = read(saveKey(id));
    if (raw == null) return this.fail('missing');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return this.fail('damaged');
    }
    if (!this.apply(data)) return this.fail('damaged');
    if (id !== AUTOSAVE_ID) this.current = { id, name: cleanName(data.name) || 'My island' };
    this.lastError = null;
    return true;
  }

  remove(id) {
    remove(saveKey(id));
    remove(thumbKey(id));
    this.writeIndex(this.readIndex().filter((m) => m.id !== id));
    if (this.current?.id === id) this.current = null;
  }

  loadAutosave() {
    if (!this.autosaveEnabled || read(saveKey(AUTOSAVE_ID)) == null) return false;
    return this.load(AUTOSAVE_ID);
  }

  startAutosave(seconds = 60) {
    if (!this.autosaveEnabled) return;
    clearInterval(this.timer);
    const ms = Math.max(5, Number(seconds) || 60) * 1000;
    this.timer = setInterval(() => this.autosave(), ms);
    if (this.hooked) return;
    this.hooked = true;
    // Thumbnails are skipped on the way out; capturing one can be slow.
    const onLeave = () => {
      // Closing a tab fires several of these in a row; one write is enough.
      if (Date.now() - this.lastAutosaveAt < 400) return;
      this.autosave({ thumb: false });
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onLeave();
    });
    addEventListener('beforeunload', onLeave);
  }

  // Returns true when the autosave was written, false when it failed, and null
  // when autosave is turned off.
  autosave({ thumb } = {}) {
    if (!this.autosaveEnabled) return null;
    const now = Date.now();
    this.lastAutosaveAt = now;
    const wantThumb = thumb ?? (now - this.lastThumbAt > AUTOSAVE_THUMB_EVERY || read(thumbKey(AUTOSAVE_ID)) == null);
    const payload = this.payload('Autosave', { thumb: wantThumb, quiet: true });
    if (!payload) return false;
    if (payload.thumb) this.lastThumbAt = now;
    // Only warn once per session if the autosave keeps failing.
    const ok = this.write(AUTOSAVE_ID, payload, { quiet: this.warnedAutosave });
    if (!ok) this.warnedAutosave = true;
    return ok;
  }

  exportFile(name) {
    const clean = cleanName(name) || this.current?.name || 'My island';
    const payload = this.payload(clean, { thumb: true });
    if (!payload) return false;
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug(clean)}.buildagon.json`;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (err) {
      console.error('[saves] export failed', err);
      this.lastError = "Couldn't export this world.";
      return false;
    }
  }

  async importFile(file) {
    if (!file) return false;
    if (file.size > MAX_IMPORT_BYTES) return this.fail('tooBig');
    let text;
    try {
      text = await file.text();
    } catch {
      return this.fail('unreadable');
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return this.fail('invalid');
    }
    if (!this.apply(data)) return this.fail('invalid');
    const fallback = String(file.name || '').replace(/(\.buildagon)?\.json$/i, '');
    this.current = { id: null, name: cleanName(data.name) || cleanName(fallback) || 'Imported island' };
    this.lastError = null;
    return true;
  }

  // ---- Internals ------------------------------------------------------------

  payload(name, { thumb = false, quiet = false } = {}) {
    const { world, sky, cameraRig, hotbars } = this.ctx;
    try {
      return {
        version: VERSION,
        name,
        date: Date.now(),
        world: world.serialize(),
        time: Number.isFinite(sky?.time) ? sky.time : 10,
        camera: cameraRig?.getPose?.() ?? null,
        hotbars: hotbars?.toJSON?.() ?? null,
        thumb: thumb ? this.thumbnail() : null,
      };
    } catch (err) {
      console.error('[saves] could not serialize the world', err);
      if (quiet) this.lastError = MESSAGES.read;
      else this.fail('read', { notify: true });
      return null;
    }
  }

  thumbnail() {
    try {
      return this.ctx.pipeline?.captureThumbnail?.(THUMB_W, THUMB_H) ?? null;
    } catch (err) {
      console.warn('[saves] thumbnail capture failed', err);
      return null;
    }
  }

  write(id, payload, { quiet = false } = {}) {
    const { thumb, ...rest } = payload;
    let json;
    try {
      json = JSON.stringify(rest);
    } catch {
      if (!quiet) this.fail('read', { notify: true });
      return false;
    }
    const err = store(saveKey(id), json);
    if (err) {
      this.fail(isQuota(err) ? 'quota' : 'blocked', { notify: !quiet });
      return false;
    }
    // Thumbnails are optional. If one doesn't fit, drop it rather than fail.
    if (thumb && store(thumbKey(id), thumb)) remove(thumbKey(id));

    const index = this.readIndex().filter((m) => m.id !== id);
    index.push({ id, name: payload.name, date: payload.date });
    const indexErr = this.writeIndex(index);
    if (indexErr) {
      this.fail(isQuota(indexErr) ? 'quota' : 'blocked', { notify: !quiet });
      return false;
    }
    this.lastError = null;
    return true;
  }

  readIndex() {
    const raw = read(INDEX_KEY);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter((m) => isObj(m) && typeof m.id === 'string' && m.id);
    } catch {
      return [];
    }
  }

  writeIndex(list) {
    return store(INDEX_KEY, JSON.stringify(list));
  }

  fail(kind, { notify = false } = {}) {
    this.lastError = MESSAGES[kind] ?? MESSAGES.invalid;
    if (notify) this.emit('error', this.lastError);
    return false;
  }

  // Validate and apply a payload. Restores the previous world if loading throws.
  apply(raw) {
    const data = sanitize(raw);
    if (!data) return false;
    const { world, sky, cameraRig, hotbars } = this.ctx;
    let backup = null;
    try {
      backup = world.serialize();
    } catch {
      backup = null;
    }
    try {
      world.load(data.world);
    } catch (err) {
      console.error('[saves] world.load failed', err);
      if (backup) {
        try {
          world.load(backup);
        } catch {
          // Nothing more to do; the world stays as it is.
        }
      }
      return false;
    }
    if (sky && Number.isFinite(data.time)) sky.time = ((data.time % 24) + 24) % 24;
    try {
      if (data.camera && cameraRig?.setPose) cameraRig.setPose(data.camera);
      else cameraRig?.reset?.();
    } catch (err) {
      console.warn('[saves] could not restore the camera', err);
    }
    try {
      if (data.hotbars) hotbars?.fromJSON?.(data.hotbars);
    } catch (err) {
      console.warn('[saves] could not restore the hotbars', err);
    }
    return true;
  }
}

// ---- Validation ---------------------------------------------------------------

function sanitize(p) {
  if (!isObj(p)) return null;
  if (typeof p.version !== 'number' || p.version < 1 || p.version > VERSION) return null;
  const w = p.world;
  if (!isObj(w) || !Array.isArray(w.cells)) return null;

  const cells = w.cells.filter(
    (c) =>
      Array.isArray(c) &&
      c.length >= 4 &&
      Number.isInteger(c[0]) &&
      Number.isInteger(c[1]) &&
      Number.isFinite(c[2]) &&
      typeof c[3] === 'string' &&
      Object.hasOwn(TERRAIN, c[3]),
  );

  const usedIds = new Set();
  let nextId = 1;
  const objects = [];
  for (const o of Array.isArray(w.objects) ? w.objects : []) {
    if (!isObj(o) || typeof o.item !== 'string' || !getItem(o.item)) continue;
    if (!Array.isArray(o.p) || o.p.length !== 3 || !o.p.every(Number.isFinite)) continue;
    let id = Number.isInteger(o.id) && o.id > 0 && !usedIds.has(o.id) ? o.id : null;
    if (id == null) {
      while (usedIds.has(nextId)) nextId++;
      id = nextId;
    }
    usedIds.add(id);
    objects.push({
      ...o,
      id,
      variant: Number.isInteger(o.variant) && o.variant >= 0 ? o.variant : 0,
      rotY: Number.isFinite(o.rotY) ? o.rotY : 0,
      scale: Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1,
      seed: Number.isFinite(o.seed) ? o.seed : 1,
    });
  }

  return {
    name: typeof p.name === 'string' ? p.name : '',
    world: { ...w, cells, objects, meta: isObj(w.meta) ? w.meta : {} },
    time: Number(p.time),
    camera: isObj(p.camera) ? p.camera : null,
    hotbars: sanitizeHotbars(p.hotbars),
  };
}

function sanitizeHotbars(h) {
  if (!isObj(h) || !Array.isArray(h.presets) || !h.presets.length) return null;
  const presets = h.presets
    .filter((p) => isObj(p) && Array.isArray(p.slots))
    .map((p) => ({
      name: typeof p.name === 'string' && p.name ? p.name.slice(0, 40) : 'Preset',
      slots: Array.from({ length: 9 }, (_, i) => {
        const id = p.slots[i];
        return typeof id === 'string' && getItem(id) ? id : null;
      }),
    }));
  if (!presets.length) return null;
  const clampInt = (v, max) => (Number.isInteger(v) ? Math.max(0, Math.min(max, v)) : 0);
  return {
    presets,
    activePreset: clampInt(h.activePreset, presets.length - 1),
    activeSlot: clampInt(h.activeSlot, 8),
  };
}

// ---- Storage helpers ------------------------------------------------------------

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Returns null on success, or the error.
function store(key, value) {
  try {
    localStorage.setItem(key, value);
    return null;
  } catch (err) {
    return err ?? new Error('Storage failed');
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore; there's nothing useful to do.
  }
}

function isQuota(err) {
  return (
    err?.name === 'QuotaExceededError' ||
    err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err?.code === 22 ||
    err?.code === 1014 ||
    /quota/i.test(err?.message ?? '')
  );
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 40);
}

function slug(name) {
  return (
    cleanName(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'buildagon-world'
  );
}
