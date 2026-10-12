// Procedural audio. Every sound is synthesized with WebAudio; there are no files.
//
// Graph: voices → SFX, ambience, and music buses → master → glue compressor →
// limiter → speakers. A shared warm reverb takes sends from all three buses.
//
//   unlock()                    create or resume the context (call on a user gesture)
//   play(name, opts)            one-shot effect; see sfx.js for the names
//   setAmbience({ night, water, waterfall, height, wind })   every frame
//   applySettings(settings)     master, SFX, ambience, and music volume
//   update(dt)                  drives the ambience beds and music

import { SFX } from './sfx.js';
import { Ambience } from './ambience.js';
import { Music } from './music.js';
import { TrackPlayer } from './tracks.js';
import { Voice, makeNoiseBuffers, makeImpulse, glideParam } from './synth.js';

const MAX_VOICES = 32;
const DEFAULT_SPREAD = 0.045;
const DEFAULT_GAP = 0.03;

// Perceptual volume curve for sliders.
const curve = (v) => {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  return x * x;
};

export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.voices = 0;
    this.lastPlayed = new Map();
    this.ambienceTarget = { night: 0, water: 0, waterfall: 0, height: 10, wind: 1 };
    this.ambienceLevel = 0;
    this.musicLevel = 0;
    this.suspendedByPage = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      } catch (err) {
        console.warn('[audio] WebAudio is unavailable', err);
        this.ctx = null;
        return;
      }
      document.addEventListener('visibilitychange', () => this.onVisibility());
    }
    if (this.ctx.state === 'suspended' && document.visibilityState !== 'hidden') {
      this.ctx.resume().catch(() => {});
    }
  }

  build() {
    const ctx = this.ctx;
    this.noise = makeNoiseBuffers(ctx);

    // Gentle glue compression, then a brick-wall-ish limiter.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 14;
    glue.ratio.value = 3;
    glue.attack.value = 0.006;
    glue.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    this.master = ctx.createGain();
    this.master.connect(glue);
    glue.connect(limiter);
    limiter.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    for (const bus of [this.sfxBus, this.ambBus, this.musicBus]) {
      bus.gain.value = 0;
      bus.connect(this.master);
    }

    this.reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.55;
    this.reverbIn.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(this.master);

    this.applySettings(this.settings);
    this.ambience = new Ambience(this);
    this.music = new Music(this);
    this.tracks = new TrackPlayer(this);
    this.tracks.onTrack = (track) => this.onTrack?.(track);
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  play(name, { pitch = 1, volume = 1, pan = 0 } = {}) {
    // A sound played during a click or key press can start the context itself.
    if (!this.ctx && navigator.userActivation?.isActive) this.unlock();
    if (!this.running) return;
    const recipe = SFX[name];
    if (!recipe) return;

    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < (recipe.gap ?? DEFAULT_GAP)) return;
    if (this.voices >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    const spread = recipe.spread ?? DEFAULT_SPREAD;
    const voice = new Voice(this, {
      bus: this.sfxBus,
      pitch: Math.max(0.25, Number(pitch) || 1) * (1 + (Math.random() * 2 - 1) * spread),
      volume: Math.max(0, Number(volume) || 0) * (recipe.gain ?? 1),
      pan: Number(pan) || 0,
      reverb: recipe.reverb ?? 0.1,
    });
    try {
      recipe.play(voice);
    } finally {
      voice.finish();
    }
  }

  // Play a soundtrack piece now (from the About page). Call from a click so the
  // audio context can start.
  playTrack(track) {
    this.unlock();
    if (!this.tracks) return;
    this.tracks.playNow(track);
  }

  get nowPlaying() {
    const t = this.tracks;
    return t && (t.state === 'playing' || t.state === 'loading') ? t.current : null;
  }

  setAmbience(values) {
    if (!values) return;
    for (const key of Object.keys(this.ambienceTarget)) {
      const v = Number(values[key]);
      if (Number.isFinite(v)) this.ambienceTarget[key] = v;
    }
  }

  // `settings` always holds every key (it starts as a copy of DEFAULT_SETTINGS).
  applySettings(settings = this.settings) {
    this.settings = settings;
    if (!this.ctx) return;
    const s = settings;
    this.ambienceLevel = curve(s.ambienceVolume);
    this.musicLevel = curve(s.musicVolume);
    glideParam(this.master.gain, curve(s.masterVolume), this.ctx, 0.04);
    glideParam(this.sfxBus.gain, curve(s.sfxVolume), this.ctx, 0.04);
    glideParam(this.ambBus.gain, this.ambienceLevel, this.ctx, 0.15);
    glideParam(this.musicBus.gain, this.musicLevel * 0.9, this.ctx, 0.3);
  }

  update(dt) {
    if (!this.running) return;
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    this.ambience.update(step, this.ambienceTarget);
    // Music style: 'piano' plays the soundtrack, 'chimes' the generative bells.
    const style = this.settings?.musicStyle ?? 'piano';
    const audible = this.musicLevel >= 0.001;
    this.tracks.update(step, audible && style === 'piano');
    this.music.update(this.ambience.level.night, audible && style === 'chimes');
  }

  onVisibility() {
    if (!this.ctx) return;
    if (document.visibilityState === 'hidden') {
      this.tracks?.setPaused(true);
      if (this.ctx.state === 'running') {
        this.suspendedByPage = true;
        this.ctx.suspend().catch(() => {});
      }
    } else if (this.suspendedByPage) {
      this.suspendedByPage = false;
      this.ctx.resume().catch(() => {});
      this.tracks?.setPaused(false);
    }
  }
}
