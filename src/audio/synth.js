// WebAudio building blocks: noise buffers, a warm reverb impulse, and Voice, a
// short-lived sound that schedules tones and filtered noise bursts.

const MIN_GAIN = 0.0001;
const MAX_FREQ = 18000;

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clampFreq = (f) => Math.max(20, Math.min(MAX_FREQ, f));

// White, pink, and brown noise, a few seconds each, for looping beds and bursts.
export function makeNoiseBuffers(ctx) {
  const make = (seconds, fill) => {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    fill(buf.getChannelData(0));
    return buf;
  };
  const white = make(3, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  });
  // Paul Kellet's economy pink filter.
  const pink = make(7, (d) => {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  });
  const brown = make(7, (d) => {
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  });
  return { white, pink, brown };
}

// A soft, slightly dark room tail. Stereo noise with an exponential decay that
// gets duller as it fades.
export function makeImpulse(ctx, seconds = 2.4, power = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const fadeIn = Math.floor(ctx.sampleRate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.32 - 0.24 * t);
      d[i] = lp * Math.pow(1 - t, power) * Math.min(1, i / fadeIn);
    }
  }
  return buf;
}

// Ramp an AudioParam toward a value without piling up automation events.
export function glideParam(param, value, ctx, time = 0.08) {
  if (param._target !== undefined && Math.abs(param._target - value) < 1e-4) return;
  param._target = value;
  param.setTargetAtTime(value, ctx.currentTime, time);
}

// One sound: an output gain and stereo panner, plus a reverb send. Every tone()
// and noise() call schedules relative to the voice's start time. Call finish()
// once everything is scheduled so the nodes disconnect after the sound ends.
export class Voice {
  constructor(sys, { bus, pitch = 1, volume = 1, pan = 0, reverb = 0, delay = 0 }) {
    const ctx = sys.ctx;
    this.sys = sys;
    this.ctx = ctx;
    this.p = pitch;
    this.t0 = ctx.currentTime + 0.004 + delay;
    this.end = this.t0;

    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = Math.max(-1, Math.min(1, pan));
    this.out.connect(this.pan);
    this.pan.connect(bus);
    this.nodes = [this.out, this.pan];
    if (reverb > 0 && sys.reverbIn) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      this.pan.connect(send);
      send.connect(sys.reverbIn);
      this.nodes.push(send);
    }
    sys.voices += 1;
  }

  envelope(t, a, d, g, hold = 0) {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(MIN_GAIN, t);
    env.gain.linearRampToValueAtTime(g, t + a);
    if (hold > 0) env.gain.setValueAtTime(g, t + a + hold);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, t + a + hold + d);
    this.end = Math.max(this.end, t + a + hold + d + 0.05);
    return env;
  }

  // An oscillator note. `to` glides the pitch; `lp` adds a lowpass filter.
  tone({ f, to = null, at = 0, type = 'sine', a = 0.004, d = 0.2, g = 0.3, hold = 0, glide = null, lp = null, detune = 0 }) {
    const ctx = this.ctx;
    const t = this.t0 + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(clampFreq(f * this.p), t);
    if (to) osc.frequency.exponentialRampToValueAtTime(clampFreq(to * this.p), t + (glide ?? a + hold + d));
    if (detune) osc.detune.value = detune;
    const env = this.envelope(t, a, d, g, hold);
    let node = osc;
    if (lp) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = clampFreq(lp * this.p);
      filter.Q.value = 0.5;
      osc.connect(filter);
      node = filter;
    }
    node.connect(env);
    env.connect(this.out);
    osc.start(t);
    osc.stop(t + a + hold + d + 0.03);
    return this;
  }

  // A filtered noise burst. `to` sweeps the filter frequency.
  noise({ color = 'white', at = 0, a = 0.004, d = 0.2, g = 0.3, hold = 0, type = 'bandpass', f = 1000, to = null, Q = 0.8 }) {
    const ctx = this.ctx;
    const t = this.t0 + at;
    const buffer = this.sys.noise[color] ?? this.sys.noise.white;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = Q;
    filter.frequency.setValueAtTime(clampFreq(f * this.p), t);
    if (to) filter.frequency.exponentialRampToValueAtTime(clampFreq(to * this.p), t + a + hold + d);
    const env = this.envelope(t, a, d, g, hold);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.out);
    const length = a + hold + d + 0.05;
    const offset = Math.random() * Math.max(0, buffer.duration - length - 0.05);
    src.start(t, offset);
    src.stop(t + length);
    return this;
  }

  // Soft bell: a sine with gentle, quickly fading overtones.
  bell(f, { at = 0, d = 1.2, g = 0.12 } = {}) {
    this.tone({ f, at, a: 0.006, d, g });
    this.tone({ f: f * 2, at, a: 0.004, d: d * 0.45, g: g * 0.28 });
    this.tone({ f: f * 3.01, at, a: 0.003, d: d * 0.2, g: g * 0.1 });
    return this;
  }

  // Wooden marimba: round fundamental plus a bright, fast-decaying fourth partial.
  marimba(f, { at = 0, d = 0.7, g = 0.14 } = {}) {
    this.tone({ f, at, a: 0.003, d, g });
    this.tone({ f: f * 3.98, at, a: 0.002, d: 0.09, g: g * 0.35 });
    this.noise({ at, f: f * 6, Q: 3, a: 0.001, d: 0.025, g: g * 0.25 });
    return this;
  }

  finish() {
    const ms = Math.max(0, (this.end - this.ctx.currentTime + 0.25) * 1000);
    setTimeout(() => {
      for (const n of this.nodes) n.disconnect();
      this.sys.voices = Math.max(0, this.sys.voices - 1);
    }, ms);
  }
}
