// Base class for rare visitors: animals that live in a habitat but only show
// up now and then.
//
// A visitor stays out of sight ('away') until its time window opens, such as
// past midnight or at dawn. Each time the window opens it rolls `chance`. After
// `pity` misses in a row the next window is a sure thing, so a habitat that's
// been waiting a while never feels broken. During a visit the species runs
// its own states; it calls goAway() when the visit ends.
//
// Subclasses set `this.cfg = { chance, pity, delay: [min, max] }` and
// implement inWindow(), visit(), visitTick(dt), and depart(). depart() plays
// the exit and calls goAway() (or sets gone when leaving for good).

import { Creature } from './Creature.js';

export class Visitor extends Creature {
  constructor(ctx, slot, opts) {
    super(ctx, slot, opts);
    this.cfg = { chance: 0.35, pity: 2, delay: [3, 20] };
    this.misses = 0;
    this.wasOpen = false;
    this.pending = -1; // Seconds until a scheduled visit, or -1.
    this.visits = 0;
  }

  start() {
    this.set('away');
    this.hidden = true;
  }

  // Make the next open window a sure thing, and skip the wait. For testing:
  // game.wildlife.summon('fairy').
  summon() {
    this.misses = this.cfg.pity;
    this.wasOpen = false;
    this.forced = true;
  }

  onLeave() {
    if (this.state === 'away') {
      this.gone = true;
      return;
    }
    this.depart();
  }

  goAway() {
    this.set('away');
    this.hidden = true;
    if (this.leaving) this.gone = true;
  }

  tick(dt) {
    if (this.state !== 'away') {
      this.visitTick(dt);
      return;
    }
    this.hidden = true;
    if (this.leaving) {
      this.gone = true;
      return;
    }
    const open = this.inWindow();
    if (open && !this.wasOpen) {
      if (this.forced || this.misses >= this.cfg.pity || Math.random() < this.cfg.chance) {
        const [a, b] = this.cfg.delay;
        this.pending = this.forced ? 0.5 : a + Math.random() * (b - a);
        this.misses = 0;
      } else {
        this.misses++;
      }
      this.forced = false;
    }
    if (!open) this.pending = -1;
    this.wasOpen = open;
    if (this.pending >= 0) {
      this.pending -= dt;
      if (this.pending < 0) {
        this.hidden = false;
        this.visits++;
        this.visit();
      }
    }
  }

  // Hour helpers. `ctx.hour` runs 0 to 24.
  between(from, to) {
    const h = this.ctx.hour;
    return from <= to ? h >= from && h < to : h >= from || h < to;
  }

  inWindow() {
    return false;
  }
  visit() {}
  visitTick() {}
  depart() {
    this.goAway();
  }
}
