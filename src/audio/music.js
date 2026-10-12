// Sparse generative music: short pentatonic phrases on soft bells or marimba,
// separated by long rests. Slower and lower at night.

import { Voice, rand, pick } from './synth.js';

const SCALE = [0, 2, 4, 7, 9]; // Major pentatonic.
const ROOT = 261.63; // C4.

function noteFreq(index) {
  const octave = Math.floor(index / SCALE.length);
  const degree = SCALE[((index % SCALE.length) + SCALE.length) % SCALE.length];
  return ROOT * 2 ** ((degree + 12 * octave) / 12);
}

export class Music {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.next = 0;
    this.index = 5;
  }

  // enabled: false while chimes aren't the music style or the volume is zero.
  update(night, enabled) {
    const now = this.ctx.currentTime;
    if (!enabled) {
      this.next = 0;
      return;
    }
    if (!this.next) this.next = now + rand(3, 7);
    if (now + 0.25 < this.next) return;
    const end = this.phrase(Math.max(this.next, now + 0.05), night);
    this.next = end + rand(6, 14) * (night > 0.5 ? 1.3 : 1);
  }

  // Schedule one phrase starting at time t0. Returns when it ends.
  phrase(t0, night) {
    const v = new Voice(this.sys, {
      bus: this.sys.musicBus,
      delay: t0 - this.ctx.currentTime,
      pan: rand(-0.35, 0.35),
      reverb: 0.45,
    });
    const instrument = Math.random() < 0.7 ? 'bell' : 'marimba';
    const beat = night > 0.5 ? rand(0.6, 0.75) : rand(0.42, 0.55);
    const octaveShift = night > 0.5 ? -SCALE.length : 0;
    const notes = 3 + Math.floor(Math.random() * 4);
    let at = 0;

    for (let i = 0; i < notes; i++) {
      this.index = Math.max(0, Math.min(10, this.index + pick([-2, -1, -1, 0, 1, 1, 2])));
      const f = noteFreq(this.index + octaveShift);
      const g = rand(0.07, 0.11);
      if (instrument === 'bell') v.bell(f, { at, d: rand(1.4, 2.2), g });
      else v.marimba(f, { at, d: rand(0.6, 0.9), g: g * 1.2 });
      at += beat * pick([1, 1, 1, 2, 0.5]);
    }

    // Sometimes a soft low note underneath.
    if (Math.random() < 0.35) {
      v.tone({ f: noteFreq(pick([0, 3]) - SCALE.length), a: 0.4, d: 2.6, g: 0.05 });
    }
    v.finish();
    return t0 + at + 1.5;
  }
}
