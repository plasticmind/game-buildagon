// Soundtrack player in the spirit of Minecraft: a calm piano piece now and then,
// with long quiet stretches of ambience in between. Tracks stream from
// public/music through the music bus, so the music volume slider applies.
// See public/music/CREDITS.md for sources and licenses.

import { rand } from './synth.js';

// Every track is CC0. `source` links to the original page for credits. URLs are
// relative to the page, so the game works from any folder.
const OGA = 'https://opengameart.org/content/';
export const TRACKS = [
  { url: 'music/infinite-world.mp3', title: 'Infinite World', author: 'Umplix', source: `${OGA}infinite-world` },
  { url: 'music/first-light-particles.mp3', title: 'First Light Particles', author: 'Yoiyami', source: 'https://opengameart.org/node/182244' },
  { url: 'music/chilly-bells.mp3', title: 'Chilly Bells', author: 'Alex McCulloch (Pro Sensory)', source: `${OGA}chilly-bells` },
  { url: 'music/its-not-undertale-2.mp3', title: "It's Not Undertale 2", author: 'PaulinusDavis', source: `${OGA}its-not-undertale-2` },
  { url: 'music/ooame.mp3', title: 'Ooame', author: 'TAD', source: `${OGA}ooame` },
  { url: 'music/calm-ambient-3.mp3', title: 'Calm Ambient 3', author: 'cynicmusic', source: `${OGA}calm-ambient-3-lifewave-2k` },
  { url: 'music/aquaria.mp3', title: 'Aquaria', author: 'cynicmusic', source: `${OGA}aquaria` },
  { url: 'music/heavenly-loop.mp3', title: 'Heavenly Loop', author: 'isaiah658', source: `${OGA}heavenly-loop` },
];

// Like Minecraft's creative mode: music drifts in now and then, never on a loop.
const FIRST_DELAY = [8, 16]; // Seconds of quiet before the first track.
const GAP = [70, 200]; // Seconds of quiet between tracks.
const FADE_IN = 2.5;
const FADE_OUT = 1.5;

export class TrackPlayer {
  constructor(sys, tracks = TRACKS) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.tracks = tracks;
    this.queue = [];
    this.current = null;
    this.state = 'waiting'; // 'waiting' | 'loading' | 'playing' | 'stopping'
    this.wait = rand(...FIRST_DELAY);
    this.onTrack = null; // (track) => void, called when a track starts.

    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this._finish());
    this.el.addEventListener('error', () => this._finish());
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.ctx.createMediaElementSource(this.el).connect(this.gain);
    this.gain.connect(sys.musicBus);
  }

  // enabled: false while the music style isn't piano or the volume is zero.
  update(dt, enabled) {
    if (!enabled) {
      if (this.state === 'playing' || this.state === 'loading') this.stop();
      return;
    }
    if (this.state !== 'waiting') return;
    this.wait -= dt;
    if (this.wait <= 0) this._start();
  }

  // Fade out and go back to waiting. The next track comes after a full gap.
  stop() {
    if (this.state !== 'playing' && this.state !== 'loading') return;
    this.state = 'stopping';
    this._ramp(0, FADE_OUT);
    setTimeout(() => {
      this.el.pause();
      this._finish();
    }, FADE_OUT * 1000);
  }

  // Start a specific track right away, cutting off whatever is playing.
  playNow(track) {
    this.el.pause();
    this.queue = [track, ...this.queue.filter((t) => t !== track)];
    this.state = 'waiting';
    this._start();
  }

  // The page went to the background: pause so the track doesn't run silently.
  setPaused(paused) {
    if (this.state !== 'playing') return;
    if (paused) this.el.pause();
    else this.el.play().catch(() => {});
  }

  _next() {
    if (!this.queue.length) {
      this.queue = [...this.tracks].sort(() => Math.random() - 0.5);
      // Don't repeat the track that just played.
      if (this.queue.length > 1 && this.queue[0] === this.current) this.queue.push(this.queue.shift());
    }
    return this.queue.shift();
  }

  _start() {
    const track = this._next();
    if (!track) return;
    this.current = track;
    this.state = 'loading';
    this.el.src = track.url;
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.el
      .play()
      .then(() => {
        if (this.state !== 'loading') return;
        this.state = 'playing';
        this._ramp(1, FADE_IN);
        this.onTrack?.(track);
      })
      .catch(() => this._finish());
  }

  _finish() {
    this.state = 'waiting';
    this.wait = rand(...GAP);
  }

  _ramp(value, seconds) {
    const g = this.gain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(value, now + seconds);
  }
}
