// Ambience beds: wind, water lapping, and a waterfall rush as looping filtered
// noise, plus sparse synthesized birdsong by day and crickets at night.

import { Voice, glideParam, rand, pick } from './synth.js';
import { clamp01 } from '../core/math.js';


export class Ambience {
  constructor(sys) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.out = sys.ambBus;
    this.t = 0;

    // Smoothed inputs. Targets come from setAmbience() every frame.
    this.level = { night: 0, water: 0, waterfall: 0, height: 10, wind: 1 };
    this.gust = 0.4;
    this.gustTarget = 0.4;
    this.gustTimer = 0;
    this.paramTimer = 0;
    this.birdTimer = rand(2, 5);
    this.plipTimer = rand(1, 3);
    this.crickets = [
      { f: 4300, pan: -0.55, period: 0.62, next: 0 },
      { f: 4750, pan: 0.5, period: 0.81, next: 0 },
      { f: 3950, pan: 0.05, period: 1.07, next: 0 },
    ];

    const { pink, brown, white } = sys.noise;

    // Wind: pink noise through a wandering bandpass.
    this.wind = this.bed(pink, [
      ['bandpass', 520, 0.6],
      ['lowpass', 2200, 0.5],
    ]);
    // Water lapping: low brown noise with slow swells.
    this.lap = this.bed(brown, [['lowpass', 420, 0.7]]);
    // Waterfall: a bright rush plus a low rumble.
    this.fall = this.bed(white, [
      ['bandpass', 1300, 0.45],
      ['lowpass', 4200, 0.5],
    ]);
    this.rumble = this.bed(brown, [['lowpass', 240, 0.6]]);
  }

  // A looping noise source through a chain of filters into a silent gain.
  bed(buffer, filters) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    let node = src;
    const nodes = [];
    for (const [type, freq, q] of filters) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      node.connect(f);
      node = f;
      nodes.push(f);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    gain.connect(this.out);
    src.start(ctx.currentTime, Math.random() * buffer.duration);
    return { src, filters: nodes, gain };
  }

  update(dt, target) {
    const ctx = this.ctx;
    const L = this.level;
    this.t += dt;
    const k = 1 - Math.exp(-dt * 1.6);
    for (const key of Object.keys(L)) {
      const v = Number(target[key]);
      if (Number.isFinite(v)) L[key] += (v - L[key]) * k;
    }

    const night = clamp01(L.night);
    const day = 1 - night;
    const high = clamp01((L.height - 4) / 50);
    const windAmt = Math.max(0, L.wind);

    // Gusts drift toward a new random target every few seconds.
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTarget = Math.random() ** 1.5;
      this.gustTimer = rand(2.5, 7);
    }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dt * 0.6));

    // Bed levels change slowly, so 20 updates a second is plenty.
    this.paramTimer -= dt;
    if (this.paramTimer <= 0) {
      this.paramTimer = 0.05;
      this.updateBeds(high, windAmt);
    }

    if (this.sys.ambienceLevel < 0.001) return;
    const now = ctx.currentTime;
    const water = clamp01(L.water);
    const fall = clamp01(L.waterfall);

    // Little water plips near the shore.
    this.plipTimer -= dt;
    if (this.plipTimer <= 0) {
      this.plipTimer = rand(0.6, 2.4);
      if (water > 0.15 && Math.random() < water) this.plip(water);
    }

    // Birds by day, quieter up high.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = rand(1.6, 6);
      const chance = day * (1 - high * 0.6) * (0.4 + 0.6 * (1 - fall));
      if (day > 0.25 && Math.random() < chance) this.bird(day * (1 - high * 0.5));
    }

    // Crickets at night, each on its own loose rhythm.
    const cricketLevel = night ** 1.5 * (1 - high * 0.7) * (1 - fall * 0.5);
    for (const c of this.crickets) {
      if (c.next < now) c.next = now + rand(0.05, 0.5);
      while (c.next < now + 0.15) {
        if (cricketLevel > 0.02) this.cricket(c, c.next - now, cricketLevel);
        c.next += c.period * rand(0.92, 1.08) + (Math.random() < 0.07 ? rand(1.5, 4) : 0);
      }
    }
  }

  updateBeds(high, windAmt) {
    const ctx = this.ctx;
    const L = this.level;
    const windGain = (0.05 + 0.24 * high + 0.12 * this.gust * (0.6 + high)) * Math.min(1.6, 0.12 + windAmt * 0.75);
    glideParam(this.wind.gain.gain, windGain, ctx, 0.25);
    glideParam(this.wind.filters[0].frequency, 360 + 520 * this.gust + 380 * high, ctx, 0.4);

    // Lapping swells on two slow, unrelated waves.
    const swell = clamp01(Math.sin(this.t * 1.55) * 0.55 + Math.sin(this.t * 0.61 + 1.3) * 0.45 + 0.25);
    const water = clamp01(L.water);
    glideParam(this.lap.gain.gain, water * 0.42 * (0.35 + 0.65 * swell), ctx, 0.15);
    glideParam(this.lap.filters[0].frequency, 260 + 360 * swell, ctx, 0.2);

    const fall = clamp01(L.waterfall);
    glideParam(this.fall.gain.gain, fall * 0.32, ctx, 0.2);
    glideParam(this.rumble.gain.gain, fall * 0.3, ctx, 0.2);
  }

  voice(opts) {
    return new Voice(this.sys, { bus: this.out, ...opts });
  }

  bird(level) {
    const v = this.voice({ pan: rand(-0.8, 0.8), reverb: 0.25 });
    const base = rand(2400, 4200);
    const g = 0.03 * level;
    const kind = Math.random();
    if (kind < 0.45) {
      // A few quick chirps.
      const n = 2 + Math.floor(Math.random() * 3);
      const up = Math.random() < 0.5;
      for (let i = 0; i < n; i++) {
        const f = base * rand(0.95, 1.08);
        v.tone({ f, to: up ? f * 1.3 : f * 0.78, at: i * rand(0.09, 0.13), a: 0.006, d: 0.07, g });
      }
    } else if (kind < 0.75) {
      // A two-note whistle.
      v.tone({ f: base * 0.8, to: base * 0.72, a: 0.02, d: 0.22, g: g * 0.9 });
      v.tone({ f: base * 0.95, to: base, at: 0.3, a: 0.02, d: 0.26, g: g * 0.8 });
    } else {
      // A soft trill.
      const n = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < n; i++) {
        v.tone({ f: base * (i % 2 ? 1.12 : 1), at: i * 0.045, a: 0.004, d: 0.035, g: g * (1 - i / (n + 2)) });
      }
    }
    v.finish();
  }

  cricket(c, delay, level) {
    const ctx = this.ctx;
    const v = this.voice({ pan: c.pan, delay: Math.max(0, delay), reverb: 0.15 });
    const t = v.t0;
    const osc = ctx.createOscillator();
    osc.frequency.value = c.f * rand(0.995, 1.005);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    const g = 0.022 * level;
    // Three quick pulses make one chirp.
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.042;
      env.gain.setValueAtTime(0.0001, s);
      env.gain.linearRampToValueAtTime(g, s + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, s + 0.03);
    }
    osc.connect(env);
    env.connect(v.out);
    osc.start(t);
    osc.stop(t + 0.16);
    v.end = t + 0.2;
    v.finish();
  }

  plip(water) {
    const v = this.voice({ pan: rand(-0.6, 0.6), reverb: 0.3 });
    const f = pick([700, 820, 940, 1080]);
    v.tone({ f, to: f * 1.7, glide: 0.04, a: 0.003, d: 0.06, g: 0.035 * water });
    v.finish();
  }
}
