import { TICK_RATE } from '../sim/game';
import type { GameState, SimEvent } from '../sim/types';
import { Music } from './music';

/** all: music and effects. sfx: effects only. off: silence. */
export type SoundMode = 'all' | 'sfx' | 'off';
const MODES: SoundMode[] = ['all', 'sfx', 'off'];
const STORAGE_KEY = 'snails.sound';

/** Where the player is looking, so sounds pan left/right and fade when far off screen. */
export interface Listener {
  x: number;
  /** Half the visible width, in world px. */
  halfW: number;
}

interface Loop {
  gain: GainNode;
  stop(): void;
}

interface Voice {
  gain?: number;
  /** World x of the source; omit for UI sounds (centered, full volume). */
  x?: number;
  delay?: number;
}

/**
 * All game audio, synthesized with Web Audio (no sound files). Presentation only: it listens
 * to sim events and reads state, like the renderer, and never feeds anything back.
 */
export class Sound {
  mode: SoundMode = 'all';
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music: Music | null = null;
  private noise!: AudioBuffer;
  private loops = new Map<string, Loop>();
  private charge: { osc: OscillatorNode; gain: GainNode } | null = null;
  private lastSecond = -1;

  constructor(private listener: () => Listener) {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as SoundMode | null;
      if (saved && MODES.includes(saved)) this.mode = saved;
    } catch {
      // Default mode.
    }
    // Browsers only allow audio after the player touches the page.
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Quiet while the tab is hidden (async play: waiting for the other player).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** all -> effects only -> off -> all. Returns the new mode. */
  cycle(): SoundMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    try {
      localStorage.setItem(STORAGE_KEY, this.mode);
    } catch {
      // Not remembered; fine.
    }
    this.start();
    this.apply();
    return this.mode;
  }

  private start(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      // A gentle limiter so stacked explosions never clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(ctx, this.master);
      this.apply();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  private apply(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mode === 'off' ? 0 : 0.9, t, 0.05);
    if (this.mode === 'all') this.music?.play();
    else this.music?.stop();
  }

  private get live(): boolean {
    return this.ctx !== null && this.mode !== 'off' && this.ctx.state === 'running';
  }

  // ---- building blocks ----

  /** Gain and pan for a sound at world x. */
  private place(v: Voice): { gain: number; out: AudioNode } {
    const ctx = this.ctx!;
    let gain = v.gain ?? 0.2;
    if (v.x === undefined) return { gain, out: this.sfx };
    const l = this.listener();
    const dx = v.x - l.x;
    const off = Math.max(0, Math.abs(dx) - l.halfW);
    gain /= 1 + off / 500;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, dx / Math.max(1, l.halfW))) * 0.6;
    pan.connect(this.sfx);
    return { gain, out: pan };
  }

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, v: Voice = {}): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (v.delay ?? 0);
    const { gain, out } = this.place(v);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, gain, 0.005, dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private hiss(filter: BiquadFilterType, f0: number, f1: number, dur: number, v: Voice & { q?: number; attack?: number } = {}): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (v.delay ?? 0);
    const { gain, out } = this.place(v);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = v.q ?? 0.8;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, gain, v.attack ?? 0.004, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Starts (or keeps) a looping sound while `on`; stops it once `on` turns false. */
  private loop(key: string, on: boolean, make: () => Loop | null): void {
    const cur = this.loops.get(key);
    if (on && !cur && this.live) {
      const l = make();
      if (l) this.loops.set(key, l);
    } else if (!on && cur) {
      cur.stop();
      this.loops.delete(key);
    }
  }

  private noiseLoop(filter: BiquadFilterType, freq: number, q: number, gain: number, wobble = 0): Loop {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
    src.connect(f).connect(g).connect(this.sfx);
    let lfo: OscillatorNode | null = null;
    if (wobble) {
      // Rattle: a fast square wave chops the volume (jackhammer).
      lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = wobble;
      const depth = ctx.createGain();
      depth.gain.value = gain * 0.9;
      lfo.connect(depth).connect(g.gain);
      lfo.start(t);
    }
    src.start(t);
    return {
      gain: g,
      stop: () => {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.04);
        src.stop(now + 0.3);
        lfo?.stop(now + 0.3);
      },
    };
  }

  // ---- game hooks ----

  handleEvents(state: GameState, events: SimEvent[]): void {
    if (!this.live) return;
    for (const e of events) {
      switch (e.type) {
        case 'explosion': {
          const k = Math.max(0.5, Math.min(1.4, e.r / 40));
          this.tone(110, 32, 0.55 * k, 'sine', { x: e.x, gain: 0.55 * k });
          this.hiss('lowpass', 1600, 120, 0.5 + 0.4 * k, { x: e.x, gain: 0.32 * k });
          this.hiss('bandpass', 400, 90, 1.2 * k, { x: e.x, gain: 0.08 * k, attack: 0.05, delay: 0.05 });
          break;
        }
        case 'fire': {
          const x = state.snails[e.snailId]?.x;
          switch (e.weapon) {
            case 'bazooka':
              this.hiss('bandpass', 500, 1400, 0.35, { x, gain: 0.16, q: 1.5 });
              this.tone(180, 90, 0.18, 'triangle', { x, gain: 0.08 });
              break;
            case 'grenade':
              this.hiss('bandpass', 900, 1800, 0.18, { x, gain: 0.08, q: 2 });
              break;
            case 'mine':
            case 'dynamite':
              this.tone(320, 200, 0.1, 'sine', { x, gain: 0.08 });
              break;
            case 'drill':
            case 'torch':
              this.tone(200, 260, 0.12, 'triangle', { x, gain: 0.05 });
              break;
            default:
              break;
          }
          break;
        }
        case 'bullet': {
          const uzi = state.teams[state.activeTeam]?.weapon === 'uzi';
          this.hiss('highpass', uzi ? 2500 : 1600, uzi ? 1800 : 900, uzi ? 0.06 : 0.14, { x: e.x0, gain: uzi ? 0.1 : 0.2 });
          this.tone(uzi ? 140 : 170, 55, uzi ? 0.05 : 0.12, 'square', { x: e.x0, gain: uzi ? 0.025 : 0.05 });
          if (e.hit) this.tone(900, 500, 0.04, 'triangle', { x: e.x1, gain: 0.04, delay: 0.02 });
          break;
        }
        case 'splash':
          this.hiss('lowpass', 2400, 300, 0.6, { x: e.x, gain: 0.18, attack: 0.02 });
          for (let i = 0; i < 3; i++) this.tone(500 + i * 120, 900 + i * 150, 0.07, 'sine', { x: e.x, gain: 0.03, delay: 0.1 + i * 0.09 });
          break;
        case 'drown': {
          const x = state.snails[e.snailId]?.x;
          for (let i = 0; i < 4; i++) this.tone(700 - i * 110, 300 - i * 40, 0.12, 'sine', { x, gain: 0.04, delay: 0.25 + i * 0.13 });
          break;
        }
        case 'damage': {
          const s = state.snails[e.snailId];
          this.tone(360, 240, 0.16, 'triangle', { x: s?.x, gain: Math.min(0.09, 0.03 + e.amount / 600), delay: 0.03 });
          break;
        }
        case 'death': {
          const x = state.snails[e.snailId]?.x;
          this.tone(392, 392, 0.3, 'sine', { x, gain: 0.05 });
          this.tone(330, 262, 0.5, 'sine', { x, gain: 0.05, delay: 0.25 });
          break;
        }
        case 'mineTriggered':
          this.tone(1320, 1320, 0.06, 'square', { x: e.x, gain: 0.04 });
          this.tone(1320, 1320, 0.06, 'square', { x: e.x, gain: 0.04, delay: 0.14 });
          break;
        case 'dig':
          if (state.teams[state.activeTeam]?.weapon !== 'torch') this.hiss('bandpass', 700, 250, 0.09, { x: e.x, gain: 0.06, q: 1.2 });
          break;
        case 'rope':
          // Hook lands with a thunk, or the rope flops short.
          if (e.hit) {
            this.tone(240, 110, 0.09, 'triangle', { x: e.x1, gain: 0.08 });
            this.hiss('highpass', 3000, 3000, 0.03, { x: e.x1, gain: 0.05 });
          } else {
            this.hiss('bandpass', 1500, 500, 0.2, { x: e.x1, gain: 0.05, q: 2 });
          }
          break;
        case 'knock':
          this.tone(520, 240, 0.16, 'triangle', { x: e.x, gain: 0.12 });
          this.hiss('lowpass', 900, 200, 0.12, { x: e.x, gain: 0.08 });
          break;
        case 'turn':
          this.tone(660, 660, 0.9, 'sine', { gain: 0.04 });
          this.tone(990, 990, 1.1, 'sine', { gain: 0.03, delay: 0.12 });
          break;
        case 'gameover':
          [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.9, 'sine', { gain: 0.06, delay: i * 0.16 }));
          break;
        default:
          break;
      }
    }
  }

  /** Once per frame: running tools, fuses, the charge tone and the last-seconds clock. */
  update(state: GameState): void {
    if (!this.ctx) return;
    const weapon = state.teams[state.activeTeam]?.weapon;
    const digging = state.phase === 'digging';
    this.loop('torch', digging && weapon === 'torch', () => this.noiseLoop('bandpass', 2600, 0.6, 0.05));
    this.loop('drill', digging && weapon === 'drill', () => this.noiseLoop('bandpass', 260, 1.5, 0.07, 22));
    this.loop('fuse', state.objects.some((o) => o.kind === 'dynamite' && o.fuse > 0), () => this.noiseLoop('highpass', 5000, 0.5, 0.02));
    this.updateCharge(state);

    // Soft clock ticks for the last five seconds of a turn.
    const sec = state.phase === 'aiming' ? Math.ceil(state.turnTicksLeft / TICK_RATE) : -1;
    if (sec !== this.lastSecond) {
      if (sec > 0 && sec <= 5) this.tone(1100, 1100, 0.04, 'sine', { gain: 0.035 });
      this.lastSecond = sec;
    }
  }

  /** A quiet rising note while the bazooka or grenade charges. */
  private updateCharge(state: GameState): void {
    const ctx = this.ctx!;
    const on = state.charging && this.live;
    if (on && !this.charge) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.03);
      osc.connect(gain).connect(this.sfx);
      osc.start();
      this.charge = { osc, gain };
    }
    if (this.charge) {
      if (on) {
        this.charge.osc.frequency.setTargetAtTime(220 + state.power * 520, ctx.currentTime, 0.02);
      } else {
        const now = ctx.currentTime;
        this.charge.gain.gain.setTargetAtTime(0.0001, now, 0.03);
        this.charge.osc.stop(now + 0.2);
        this.charge = null;
      }
    }
  }
}
