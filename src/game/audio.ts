import type { FX } from "./arena";

/** Original synthesized score and effects: no audio files or third-party samples. */
export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private nextBeat = 0;
  private beat = 0;
  private nextCharge = 0;
  private voices = 0;
  enabled = true;
  async unlock() {
    try {
      this.context ??= new AudioContext();
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.gain.value = this.enabled ? 0.16 : 0;
        this.master.connect(this.context.destination);
      }
      await this.context.resume();
    } catch {
      /* Audio is optional, including in browsers without Web Audio. */
    }
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        this.enabled ? 0.16 : 0,
        this.context.currentTime,
        0.04,
      );
    if (this.enabled) void this.unlock();
  }
  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType = "sine",
    volume = 0.3,
    end = frequency,
  ) {
    if (
      !this.context ||
      !this.master ||
      !this.enabled ||
      this.voices > 22 ||
      this.context.state !== "running"
    )
      return;
    const time = this.context.currentTime,
      oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, end),
      time + duration,
    );
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start();
    oscillator.stop(time + duration + 0.02);
    this.voices++;
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      this.voices--;
    };
  }
  effect(event: FX) {
    if (event.continuation) return;
    switch (event.type) {
      case "charge":
        this.tone(330, 0.22, "sine", 0.5, 880);
        break;
      case "burst":
        this.tone(65, 1.1, "sine", 0.7, 28);
        this.tone(440, 0.6, "sawtooth", 0.13, 45);
        break;
      case "armed":
        this.tone(660, 0.5, "sine", 0.3, 990);
        break;
      case "seal":
        [220, 330, 440].forEach((f) => this.tone(f, 1, "sine", 0.2));
        break;
      case "fail":
        this.tone(180, 0.25, "triangle", 0.2, 90);
        break;
      case "slash":
        this.tone(1100, 0.13, "sawtooth", 0.13, 100);
        break;
      case "block":
        this.tone(220, 0.35, "triangle", 0.5, 90);
        break;
      case "parry":
        this.tone(660, 0.4, "sine", 0.6);
        this.tone(990, 0.45, "sine", 0.4);
        break;
      case "break":
        this.tone(450, 0.18, "triangle", 0.3, 130);
        break;
      case "hurt":
        this.tone(100, 0.4, "sawtooth", 0.3, 40);
        break;
      case "boss":
        this.tone(75, 0.4, "triangle", 0.5, 40);
        break;
      case "phase":
        this.tone(82.4, 1.8, "sine", 0.4);
        this.tone(123.5, 1.8, "triangle", 0.2);
        break;
      case "domain":
        [82.4, 164.8, 247, 329.6].forEach((f) =>
          this.tone(f, 3, "sine", 0.25, f * 1.5),
        );
        break;
      case "victory":
        [261.6, 329.6, 392, 523.2].forEach((f) => this.tone(f, 2, "sine", 0.3));
        break;
      case "defeat":
        this.tone(164.8, 1.5, "triangle", 0.35, 55);
        break;
    }
  }
  update(active: boolean, phase: number, domain: boolean) {
    if (!active || !this.enabled || !this.context) {
      this.nextBeat = 0;
      return;
    }
    const now = this.context.currentTime;
    if (now < this.nextBeat) return;
    this.nextBeat = now + (domain ? 0.5 : 0.43 - phase * 0.06);
    const notes = [164.8, 247, 293.7, 329.6, 247, 196, 293.7, 220];
    this.tone(notes[this.beat % 8] * (domain ? 2 : 1), 0.5, "sine", 0.09);
    if (this.beat % 4 === 0) this.tone(65.4, 0.8, "triangle", 0.15, 55);
    if (phase > 0 && this.beat % 2 === 0) this.tone(130, 0.12, "sine", 0.2, 40);
    this.beat++;
  }
  charge(power: number) {
    if (!this.context || power <= 0) {
      this.nextCharge = 0;
      return;
    }
    const now = this.context.currentTime;
    if (now < this.nextCharge) return;
    this.nextCharge = now + 0.14;
    this.tone(70 + power * 130, 0.3, "sine", 0.12, 100 + power * 180);
    this.tone(220 + power * 400, 0.22, "triangle", 0.04);
  }
  suspend() {
    void this.context?.suspend();
    this.nextBeat = 0;
  }
}
