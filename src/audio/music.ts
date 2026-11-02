/**
 * Quiet generative background music: a slow chord loop with a soft pad, a low bass note per
 * bar and a sparse plucked melody picked at random from the chord's pentatonic notes, through
 * a gentle echo. Never the same twice, never loud.
 */

const BPM = 68;
const EIGHTH = 60 / BPM / 2;
/** Schedule notes this far ahead; the timer only has to wake up every so often. */
const LOOKAHEAD = 0.4;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Cmaj7 - Am7 - Fmaj7 - G6, as MIDI notes: [bass, ...pad, ...melody choices]. */
const CHORDS: { bass: number; pad: number[]; melody: number[] }[] = [
  { bass: 36, pad: [60, 64, 67, 71], melody: [72, 74, 76, 79, 81] },
  { bass: 45, pad: [57, 60, 64, 67], melody: [69, 72, 74, 76, 79] },
  { bass: 41, pad: [57, 60, 65, 69], melody: [69, 72, 74, 77, 81] },
  { bass: 43, pad: [59, 62, 67, 71], melody: [71, 74, 76, 79, 83] },
];

export class Music {
  private out: GainNode;
  private timer: number | null = null;
  private next = 0;
  private step = 0;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // Soft echo: a quiet feedback delay, darkened a little on each pass.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = EIGHTH * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.out.connect(dest);
    this.out.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(wet).connect(dest);
  }

  play(): void {
    if (this.timer !== null) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(1, t, 1.2);
    this.next = t + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 100);
    this.schedule();
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.4);
  }

  private schedule(): void {
    // After a long pause (tab hidden, context suspended) skip ahead instead of catching up.
    if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime + 0.05;
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      this.play8th(this.step, this.next);
      this.next += EIGHTH;
      this.step++;
    }
  }

  /** One eighth note of the loop; a bar is 8 of them, each chord lasts two bars. */
  private play8th(step: number, t: number): void {
    const inBar = step % 8;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];
    if (step % 16 === 0) {
      for (const n of chord.pad) this.pad(midi(n), t, EIGHTH * 16);
    }
    if (inBar === 0) this.note(midi(chord.bass), t, 2.4, 'sine', 0.05);
    if (inBar === 4 && Math.random() < 0.5) this.note(midi(chord.bass + 7), t, 1.6, 'sine', 0.03);
    // Sparse melody: more likely on the beat, quieter off it.
    const chance = inBar % 2 === 0 ? 0.42 : 0.15;
    if (Math.random() < chance) {
      const n = chord.melody[Math.floor(Math.random() * chord.melody.length)];
      this.note(midi(n), t, 1.4, 'sine', inBar % 2 === 0 ? 0.035 : 0.022);
      // A faint octave shimmer now and then.
      if (Math.random() < 0.15) this.note(midi(n + 12), t + 0.01, 0.9, 'sine', 0.01);
    }
  }

  /** A soft pluck: quick attack, long fade. */
  private note(f: number, t: number, dur: number, type: OscillatorType, gain: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** A warm pad note: slow swell and fade, filtered so it stays in the background. */
  private pad(f: number, t: number, dur: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.012, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.05);
    osc.connect(lp).connect(g).connect(this.out);
    osc.start(t);
    osc.stop(t + dur * 1.1);
  }
}
