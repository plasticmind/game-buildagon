// Minimal event emitter used across the game.

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
