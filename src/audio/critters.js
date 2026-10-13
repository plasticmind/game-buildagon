// Wildlife calls. Same recipe shape as sfx.js, but they play on the ambience
// bus (see AudioSystem.critter), so the ambience slider sets their level.
// Keep them soft: they sit under the music and the building sounds.

import { rand } from './synth.js';

export const CRITTERS = {
  // A two-part "rib-bit": a low buzzy croak, then a shorter, higher one.
  frog: {
    gain: 0.5,
    reverb: 0.2,
    play(v) {
      const f = rand(260, 330);
      v.tone({ f, to: f * 0.82, type: 'square', lp: 900, a: 0.01, d: 0.09, g: 0.16 });
      v.noise({ f: f * 3, Q: 4, a: 0.008, d: 0.08, g: 0.1 });
      v.tone({ f: f * 1.25, to: f * 1.05, type: 'square', lp: 1100, at: 0.14, a: 0.008, d: 0.07, g: 0.13 });
      v.noise({ f: f * 3.6, Q: 4, at: 0.14, a: 0.006, d: 0.06, g: 0.08 });
    },
  },

  // Nasal "quack": a sawtooth through a vocal-ish lowpass, falling at the end.
  quack: {
    gain: 0.45,
    reverb: 0.18,
    play(v) {
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const at = i * 0.2;
        v.tone({ f: 470, to: 360, type: 'sawtooth', lp: 1500, at, a: 0.012, hold: 0.05, d: 0.09, g: 0.12 });
        v.noise({ f: 1200, Q: 3, at, a: 0.01, hold: 0.04, d: 0.08, g: 0.06 });
      }
    },
  },

  // A soft, low trumpet note.
  honk: {
    gain: 0.4,
    reverb: 0.3,
    play(v) {
      v.tone({ f: 330, to: 300, type: 'triangle', lp: 900, a: 0.03, hold: 0.12, d: 0.18, g: 0.16 });
      v.tone({ f: 660, to: 600, type: 'sawtooth', lp: 1200, a: 0.03, hold: 0.1, d: 0.14, g: 0.03 });
    },
  },

  // Gull: a rising "kee" into a falling "yow", sometimes twice.
  gull: {
    gain: 0.35,
    reverb: 0.35,
    play(v) {
      const n = Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const at = i * 0.42;
        v.tone({ f: 1250, to: 1900, glide: 0.09, type: 'triangle', at, a: 0.02, d: 0.08, g: 0.1 });
        v.tone({ f: 1850, to: 1050, type: 'triangle', lp: 2600, at: at + 0.09, a: 0.01, hold: 0.05, d: 0.2, g: 0.11 });
      }
    },
  },

  // A songbird phrase: quick chirps or a little trill.
  chirp: {
    gain: 0.4,
    reverb: 0.25,
    play(v) {
      const base = rand(2600, 4200);
      if (Math.random() < 0.55) {
        const n = 2 + Math.floor(Math.random() * 3);
        const up = Math.random() < 0.5;
        for (let i = 0; i < n; i++) {
          const f = base * rand(0.95, 1.08);
          v.tone({ f, to: up ? f * 1.3 : f * 0.78, at: i * rand(0.09, 0.13), a: 0.006, d: 0.07, g: 0.08 });
        }
      } else {
        const n = 6 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          v.tone({ f: base * (i % 2 ? 1.12 : 1), at: i * 0.045, a: 0.004, d: 0.035, g: 0.07 * (1 - i / (n + 2)) });
        }
      }
    },
  },

  // A small, questioning "mew" that rises and falls.
  meow: {
    gain: 0.4,
    reverb: 0.15,
    play(v) {
      const f = rand(560, 700);
      v.tone({ f: f * 0.8, to: f * 1.25, glide: 0.16, type: 'triangle', lp: 2200, a: 0.03, hold: 0.1, d: 0.22, g: 0.13 });
      v.tone({ f: f * 1.6, to: f * 2.3, glide: 0.16, type: 'sine', a: 0.03, hold: 0.08, d: 0.18, g: 0.03 });
    },
  },

  // A soft flurry of wingbeats.
  flap: {
    gain: 0.45,
    reverb: 0.1,
    play(v) {
      for (let i = 0; i < 5; i++) v.noise({ color: 'pink', type: 'lowpass', f: 900, at: i * 0.075, a: 0.01, d: 0.05, g: 0.2 * (1 - i * 0.12) });
    },
  },

  // Something landing in or leaping out of the water.
  splash: {
    gain: 0.45,
    reverb: 0.2,
    play(v) {
      v.noise({ f: 1800, to: 700, Q: 0.8, a: 0.005, d: 0.22, g: 0.18 });
      v.tone({ f: 620, to: 1100, glide: 0.05, a: 0.003, d: 0.06, g: 0.06 });
    },
  },

  // A frog slipping into the water.
  plop: {
    gain: 0.45,
    reverb: 0.25,
    play(v) {
      v.tone({ f: 380, to: 900, glide: 0.06, a: 0.003, d: 0.08, g: 0.12 });
      v.noise({ f: 1400, Q: 1.2, a: 0.004, d: 0.1, g: 0.06 });
    },
  },

  // A dabble or a kiss at the surface.
  plip: {
    gain: 0.4,
    reverb: 0.25,
    play(v) {
      const f = rand(700, 1000);
      v.tone({ f, to: f * 1.7, glide: 0.04, a: 0.003, d: 0.06, g: 0.08 });
    },
  },

  // The fairy: a quick, sparkling run of bells up the scale.
  fairy: {
    gain: 0.5,
    reverb: 0.45,
    spread: 0.02,
    play(v) {
      const notes = [1046.5, 1318.5, 1568, 2093, 2637];
      notes.forEach((f, i) => v.bell(f, { at: i * 0.07, d: 0.9, g: 0.05 }));
      v.noise({ f: 7000, Q: 0.8, a: 0.05, d: 0.6, g: 0.025 });
    },
  },

  // A gift appears: two soft, bright bells.
  gift: {
    gain: 0.5,
    reverb: 0.45,
    play(v) {
      v.bell(1568, { d: 1.2, g: 0.06 });
      v.bell(2349, { at: 0.12, d: 1.4, g: 0.05 });
    },
  },

  // The owl's "hoo, hoo-hoo".
  hoot: {
    gain: 0.5,
    reverb: 0.4,
    play(v) {
      const f = rand(330, 380);
      v.tone({ f, to: f * 0.93, a: 0.05, hold: 0.18, d: 0.2, g: 0.14, lp: 900 });
      v.tone({ f: f * 1.04, to: f * 0.95, at: 0.62, a: 0.03, hold: 0.08, d: 0.12, g: 0.11, lp: 900 });
      v.tone({ f: f * 1.02, to: f * 0.92, at: 0.86, a: 0.03, hold: 0.14, d: 0.2, g: 0.12, lp: 900 });
    },
  },

  // A long, low whale song.
  whale: {
    gain: 0.5,
    reverb: 0.6,
    play(v) {
      v.tone({ f: 120, to: 210, glide: 1.4, type: 'triangle', lp: 700, a: 0.5, hold: 0.9, d: 1.2, g: 0.16 });
      v.tone({ f: 240, to: 170, glide: 1.6, type: 'sine', at: 1.8, a: 0.4, hold: 0.6, d: 1.2, g: 0.1 });
    },
  },

  // A whale's blow: a long breathy whoosh.
  spout: {
    gain: 0.45,
    reverb: 0.3,
    play(v) {
      v.noise({ color: 'pink', type: 'bandpass', f: 900, to: 400, Q: 0.6, a: 0.06, hold: 0.25, d: 0.7, g: 0.3 });
      v.noise({ color: 'brown', type: 'lowpass', f: 300, a: 0.05, d: 0.6, g: 0.25 });
    },
  },

  // The fox's short, high yip.
  yip: {
    gain: 0.4,
    reverb: 0.25,
    play(v) {
      v.tone({ f: 900, to: 1350, glide: 0.05, type: 'triangle', lp: 2600, a: 0.008, d: 0.12, g: 0.12 });
    },
  },

  // The bear munching a fish.
  munch: {
    gain: 0.45,
    reverb: 0.1,
    play(v) {
      for (let i = 0; i < 4; i++) v.noise({ color: 'brown', type: 'lowpass', f: 600, at: i * 0.16, a: 0.01, d: 0.08, g: 0.3 });
      v.tone({ f: 160, to: 120, type: 'triangle', lp: 500, a: 0.04, hold: 0.2, d: 0.3, g: 0.12 });
    },
  },

  // The dragon's little smoky puff.
  puff: {
    gain: 0.45,
    reverb: 0.2,
    play(v) {
      v.noise({ color: 'pink', type: 'lowpass', f: 1200, to: 400, a: 0.02, d: 0.35, g: 0.25 });
      v.tone({ f: 220, to: 330, glide: 0.1, type: 'triangle', lp: 800, a: 0.02, d: 0.18, g: 0.08 });
    },
  },

  // Something new sprouting: a soft rustle and a tiny chime.
  sprout: {
    gain: 0.4,
    reverb: 0.3,
    play(v) {
      v.noise({ f: 4200, Q: 0.9, a: 0.01, d: 0.12, g: 0.06 });
      v.bell(rand(1300, 1600), { at: 0.03, d: 0.7, g: 0.05 });
    },
  },
};
