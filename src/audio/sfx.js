// Sound effect recipes. Each one schedules a few soft tones and noise bursts on a
// Voice. Pitches are in Hz before the voice's random pitch variation.
//
//   gain     overall level        reverb   send to the shared room
//   spread   random pitch range   gap      minimum seconds between repeats

import { rand, pick } from './synth.js';

// C major pentatonic, for the musical UI sounds.
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const G4 = 392;

export const SFX = {
  // Soft earthy thump with a tiny clack on top.
  place_tile: {
    gain: 0.9,
    reverb: 0.08,
    play(v) {
      v.tone({ f: 118, to: 58, a: 0.003, d: 0.22, g: 0.75 });
      v.noise({ color: 'brown', type: 'lowpass', f: 900, to: 180, a: 0.002, d: 0.18, g: 0.55 });
      v.noise({ f: 2600, Q: 3, at: 0.01, a: 0.001, d: 0.035, g: 0.16 });
      v.tone({ f: 1250, type: 'triangle', at: 0.01, a: 0.001, d: 0.04, g: 0.05 });
    },
  },

  // Sand and snow: a gentle hush.
  place_soft: {
    gain: 0.85,
    reverb: 0.06,
    play(v) {
      v.noise({ type: 'lowpass', f: 4200, to: 650, a: 0.02, d: 0.3, g: 0.3 });
      v.noise({ color: 'pink', f: 900, Q: 0.7, a: 0.01, d: 0.2, g: 0.2 });
      v.tone({ f: 96, to: 70, a: 0.006, d: 0.14, g: 0.28 });
    },
  },

  // Two quick stone clacks over a short body.
  place_stone: {
    gain: 0.85,
    reverb: 0.12,
    play(v) {
      v.tone({ f: 150, to: 92, a: 0.002, d: 0.13, g: 0.45 });
      v.noise({ f: 2400, Q: 4, a: 0.001, d: 0.05, g: 0.32 });
      v.tone({ f: 1800, type: 'triangle', a: 0.001, d: 0.05, g: 0.07 });
      v.tone({ f: 2720, a: 0.001, d: 0.035, g: 0.04 });
      v.noise({ f: 3100, Q: 5, at: 0.055, a: 0.001, d: 0.035, g: 0.16 });
      v.tone({ f: 2300, type: 'triangle', at: 0.055, a: 0.001, d: 0.03, g: 0.04 });
    },
  },

  // Hollow wooden knock.
  place_wood: {
    gain: 0.9,
    reverb: 0.12,
    play(v) {
      v.tone({ f: 236, to: 204, a: 0.002, d: 0.17, g: 0.5 });
      v.tone({ f: 472, to: 430, type: 'triangle', a: 0.002, d: 0.07, g: 0.1 });
      v.noise({ f: 880, Q: 6, a: 0.001, d: 0.09, g: 0.36 });
      v.noise({ f: 3000, Q: 2, a: 0.001, d: 0.02, g: 0.07 });
    },
  },

  // Leafy rustle and a little pop.
  place_leaf: {
    gain: 0.85,
    reverb: 0.1,
    play(v) {
      for (let i = 0; i < 5; i++) {
        v.noise({ f: rand(3600, 5600), Q: 0.9, at: i * 0.034 + rand(0, 0.014), a: 0.005, d: 0.06, g: 0.12 * (1 - i * 0.13) });
      }
      v.noise({ color: 'pink', type: 'lowpass', f: 1300, a: 0.01, d: 0.16, g: 0.1 });
      v.tone({ f: 520, to: 900, glide: 0.05, a: 0.003, d: 0.08, g: 0.2 });
    },
  },

  // Bloop and a soft splash.
  place_water: {
    gain: 0.85,
    reverb: 0.18,
    play(v) {
      v.tone({ f: 260, to: 720, glide: 0.1, a: 0.004, d: 0.14, g: 0.34 });
      v.tone({ f: 420, to: 980, glide: 0.07, at: 0.06, a: 0.003, d: 0.09, g: 0.14 });
      v.noise({ f: 1600, to: 900, Q: 0.6, at: 0.02, a: 0.01, d: 0.32, g: 0.22 });
    },
  },

  // A soft poof.
  destroy: {
    gain: 0.85,
    reverb: 0.12,
    play(v) {
      v.noise({ color: 'pink', type: 'lowpass', f: 2400, to: 260, a: 0.012, d: 0.34, g: 0.45 });
      v.tone({ f: 200, to: 92, a: 0.004, d: 0.2, g: 0.24 });
      v.noise({ f: 5200, Q: 1, at: 0.02, a: 0.01, d: 0.12, g: 0.04 });
    },
  },

  // Tiny detent tick.
  rotate: {
    gain: 0.7,
    reverb: 0.02,
    gap: 0.025,
    play(v) {
      v.tone({ f: 2100, type: 'triangle', a: 0.001, d: 0.026, g: 0.09 });
      v.noise({ f: 5000, Q: 2, a: 0.001, d: 0.012, g: 0.06 });
    },
  },

  // A plucked note from the pentatonic scale.
  variant: {
    gain: 0.8,
    reverb: 0.2,
    spread: 0,
    play(v) {
      const f = pick([C5, D5, E5, G5, A5]);
      v.tone({ f, type: 'triangle', a: 0.002, d: 0.34, g: 0.22, lp: 2600 });
      v.tone({ f: f * 2, a: 0.002, d: 0.12, g: 0.05 });
      v.tone({ f: f / 2, a: 0.004, d: 0.24, g: 0.08 });
    },
  },

  snap_on: {
    gain: 0.75,
    reverb: 0.15,
    play(v) {
      v.tone({ f: E5, a: 0.004, d: 0.12, g: 0.18 });
      v.tone({ f: A5 * 1.125, at: 0.07, a: 0.004, d: 0.2, g: 0.18 });
      v.noise({ f: 4200, Q: 2, at: 0.07, a: 0.001, d: 0.015, g: 0.05 });
    },
  },

  snap_off: {
    gain: 0.75,
    reverb: 0.15,
    play(v) {
      v.tone({ f: A5 * 1.125, a: 0.004, d: 0.12, g: 0.16 });
      v.tone({ f: E5, at: 0.07, a: 0.004, d: 0.2, g: 0.16 });
    },
  },

  // Into destroy mode: a soft falling pair.
  mode_destroy: {
    gain: 0.8,
    reverb: 0.2,
    play(v) {
      v.tone({ f: G4, type: 'triangle', lp: 1800, a: 0.005, d: 0.18, g: 0.18 });
      v.tone({ f: 293.66, type: 'triangle', lp: 1400, at: 0.08, a: 0.005, d: 0.32, g: 0.2 });
      v.noise({ type: 'lowpass', f: 900, to: 300, a: 0.02, d: 0.25, g: 0.07 });
    },
  },

  // Back to building: a soft rising pair.
  mode_build: {
    gain: 0.8,
    reverb: 0.2,
    play(v) {
      v.tone({ f: 293.66, type: 'triangle', lp: 1800, a: 0.005, d: 0.16, g: 0.16 });
      v.tone({ f: 440, type: 'triangle', lp: 2200, at: 0.07, a: 0.005, d: 0.3, g: 0.18 });
      v.noise({ type: 'lowpass', f: 300, to: 1200, a: 0.03, d: 0.2, g: 0.05 });
    },
  },

  ui_click: {
    gain: 0.7,
    reverb: 0.05,
    gap: 0.02,
    play(v) {
      v.tone({ f: 1100, to: 880, a: 0.001, d: 0.05, g: 0.15 });
      v.tone({ f: 2200, a: 0.001, d: 0.02, g: 0.035 });
    },
  },

  ui_hover: {
    gain: 0.45,
    reverb: 0.04,
    gap: 0.05,
    play(v) {
      v.tone({ f: 1900, a: 0.002, d: 0.03, g: 0.035 });
    },
  },

  ui_open: {
    gain: 0.8,
    reverb: 0.3,
    spread: 0.01,
    play(v) {
      v.bell(C5, { d: 0.5, g: 0.1 });
      v.bell(E5, { at: 0.05, d: 0.5, g: 0.09 });
      v.bell(G5, { at: 0.1, d: 0.6, g: 0.08 });
    },
  },

  ui_close: {
    gain: 0.7,
    reverb: 0.28,
    spread: 0.01,
    play(v) {
      v.bell(G5, { d: 0.35, g: 0.08 });
      v.bell(E5, { at: 0.05, d: 0.35, g: 0.08 });
      v.bell(C5, { at: 0.1, d: 0.45, g: 0.07 });
    },
  },

  hotbar: {
    gain: 0.75,
    reverb: 0.08,
    gap: 0.03,
    play(v) {
      v.tone({ f: 880, type: 'triangle', a: 0.002, d: 0.07, g: 0.12 });
      v.tone({ f: 1760, a: 0.002, d: 0.04, g: 0.04 });
      v.tone({ f: 440, a: 0.004, d: 0.06, g: 0.06 });
    },
  },

  preset: {
    gain: 0.8,
    reverb: 0.22,
    play(v) {
      v.bell(D5, { d: 0.25, g: 0.12 });
      v.bell(A5, { at: 0.06, d: 0.35, g: 0.12 });
      v.noise({ type: 'highpass', f: 5000, at: 0.02, a: 0.02, d: 0.15, g: 0.025 });
    },
  },

  // Gentle low boop-boop.
  error: {
    gain: 0.8,
    reverb: 0.1,
    gap: 0.15,
    spread: 0.01,
    play(v) {
      v.tone({ f: 220, to: 206, type: 'triangle', lp: 900, a: 0.01, d: 0.13, g: 0.22 });
      v.tone({ f: 185, to: 174, type: 'triangle', lp: 800, at: 0.15, a: 0.01, d: 0.2, g: 0.22 });
    },
  },

  save: {
    gain: 0.8,
    reverb: 0.35,
    spread: 0.005,
    play(v) {
      v.bell(C5, { d: 0.6, g: 0.1 });
      v.bell(E5, { at: 0.07, d: 0.6, g: 0.1 });
      v.bell(G5, { at: 0.14, d: 0.7, g: 0.1 });
      v.bell(C6, { at: 0.21, d: 1, g: 0.09 });
      v.noise({ type: 'highpass', f: 6000, at: 0.2, a: 0.05, d: 0.4, g: 0.025 });
    },
  },

  load: {
    gain: 0.8,
    reverb: 0.35,
    spread: 0.005,
    play(v) {
      v.noise({ color: 'pink', type: 'lowpass', f: 400, to: 2200, a: 0.12, d: 0.3, g: 0.06 });
      v.bell(G4, { at: 0.05, d: 0.6, g: 0.1 });
      v.bell(C5, { at: 0.13, d: 0.6, g: 0.1 });
      v.bell(E5, { at: 0.21, d: 0.9, g: 0.1 });
    },
  },

  undo: {
    gain: 0.75,
    reverb: 0.1,
    gap: 0.04,
    play(v) {
      v.tone({ f: 740, to: 520, glide: 0.08, a: 0.003, d: 0.1, g: 0.14 });
      v.noise({ f: 3000, Q: 2, a: 0.001, d: 0.015, g: 0.04 });
    },
  },

  redo: {
    gain: 0.75,
    reverb: 0.1,
    gap: 0.04,
    play(v) {
      v.tone({ f: 520, to: 740, glide: 0.08, a: 0.003, d: 0.1, g: 0.14 });
      v.noise({ f: 3000, Q: 2, a: 0.001, d: 0.015, g: 0.04 });
    },
  },
};
