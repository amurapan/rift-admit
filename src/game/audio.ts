import type { FX } from "./arena";

/** Original synthesized score and effects: no audio files or third-party samples. */
export class Sound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private scene: "silent" | "training" | "battle" = "silent";
  private duckUntil = 0;
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
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 16;
        limiter.ratio.value = 5;
        this.master.connect(limiter);
        limiter.connect(this.context.destination);
        this.music = this.context.createGain();
        this.effects = this.context.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        this.effects.connect(this.master);
        // A quiet, filtered stereo echo supplies space without decoded assets.
        this.ambience = this.context.createGain();
        this.ambience.gain.value = 0.16;
        const delay = this.context.createDelay(1);
        delay.delayTime.value = 0.29;
        const filter = this.context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 2200;
        const pan = this.context.createStereoPanner();
        pan.pan.value = 0.4;
        this.ambience
          .connect(delay)
          .connect(filter)
          .connect(pan)
          .connect(this.master);
        const noise = this.context.createBuffer(
          1,
          this.context.sampleRate,
          this.context.sampleRate,
        );
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++)
          samples[i] = Math.random() * 2 - 1;
        this.noiseBuffer = noise;
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
    delay = 0,
    attack = 0.012,
    music = false,
  ) {
    if (
      !this.context ||
      !this.master ||
      !this.enabled ||
      this.voices >= (music ? 24 : 40) ||
      this.context.state !== "running"
    )
      return;
    const time = this.context.currentTime + delay,
      oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, end),
      time + duration,
    );
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain);
    gain.connect((music ? this.music : this.effects) ?? this.master);
    if (!music && duration > 0.35 && this.ambience) gain.connect(this.ambience);
    oscillator.start(time);
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
    if (
      ["domain", "burst", "spear", "parry", "phase", "victory"].includes(
        event.type,
      )
    )
      this.duck(event.type === "domain" ? 3.4 : 0.85);
    if (["burst", "beam", "domain"].includes(event.type))
      this.noise(
        event.type === "domain" ? 1.6 : 0.65,
        0.4,
        900,
        false,
        event.type === "domain" ? 0.5 : 0,
      );
    if (event.type === "slash" || event.type === "spear")
      this.noise(0.24, 0.23, 3500);
    if (event.type === "parry") this.noise(0.12, 0.12, 6500);
    switch (event.type) {
      case "warning":
        this.tone(110, 2.7, "sine", 0.22, 440);
        this.tone(220, 0.35, "triangle", 0.2, 330);
        break;
      case "beam":
        this.tone(85, 0.7, "sine", 0.55, 35);
        this.tone(760, 0.28, "sawtooth", 0.1, 100);
        break;
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
        // A breath of silence, low impact, bell overtones, then a slow chord.
        if (this.context) this.nextBeat = this.context.currentTime + 3.5;
        this.tone(90, 0.4, "sine", 0.14, 40);
        this.tone(55, 2.4, "sine", 0.85, 28, 0.5);
        this.tone(110, 1.4, "triangle", 0.22, 55, 0.5);
        [220, 440, 660, 923].forEach((f, i) =>
          this.tone(
            f,
            2.7,
            "sine",
            0.19 / (1 + i * 0.3),
            f * 0.99,
            0.55 + i * 0.035,
          ),
        );
        [130.8, 196, 261.6, 311.1, 392].forEach((f, i) =>
          this.tone(f, 3.2, "triangle", 0.085, f, 0.8 + i * 0.07, 0.65),
        );
        break;
      case "spear":
        this.tone(180, 0.45, "sawtooth", 0.1, 1100);
        this.tone(660, 0.7, "sine", 0.35, 165, 0.08);
        break;
      case "bind":
        [220, 293.7, 440].forEach((f, i) =>
          this.tone(f, 1.4, "triangle", 0.18, f, i * 0.1),
        );
        break;
      case "rest":
        this.tone(196, 1.8, "sine", 0.2);
        this.tone(293.7, 2, "sine", 0.15, 293.7, 0.12);
        break;
      case "victory":
        [261.6, 329.6, 392, 523.2].forEach((f) => this.tone(f, 2, "sine", 0.3));
        break;
      case "defeat":
        this.tone(164.8, 1.5, "triangle", 0.35, 55);
        break;
    }
  }
  private duck(seconds: number) {
    if (!this.context) return;
    this.duckUntil = Math.max(
      this.duckUntil,
      this.context.currentTime + seconds,
    );
    this.music?.gain.setTargetAtTime(0.16, this.context.currentTime, 0.025);
  }
  private noise(
    duration: number,
    volume: number,
    frequency: number,
    music = false,
    delay = 0,
  ) {
    if (
      !this.context ||
      !this.noiseBuffer ||
      !this.enabled ||
      this.context.state !== "running" ||
      this.voices >= 40
    )
      return;
    const source = this.context.createBufferSource(),
      filter = this.context.createBiquadFilter(),
      gain = this.context.createGain();
    const time = this.context.currentTime + delay;
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(80, frequency / 4),
      time + duration,
    );
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    source
      .connect(filter)
      .connect(gain)
      .connect((music ? this.music : this.effects)!);
    source.start(time);
    source.stop(time + duration + 0.02);
    this.voices++;
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.voices--;
    };
  }
  discovery() {
    this.duck(1.8);
    this.tone(65.4, 1.4, "sine", 0.35, 49);
    [261.6, 392, 523.2, 587.3].forEach((f, i) =>
      this.tone(f, 1.8, "sine", 0.19, f, 0.12 + i * 0.14),
    );
    this.noise(1.1, 0.08, 2600);
  }
  update(
    scene: "silent" | "training" | "battle",
    phase: number,
    domain: boolean,
  ) {
    if (!this.context || !this.enabled || this.context.state !== "running")
      return;
    const now = this.context.currentTime;
    if (scene !== this.scene) {
      this.scene = scene;
      this.beat = 0;
      this.nextBeat = 0;
    }
    const volume =
      scene === "silent"
        ? 0
        : now < this.duckUntil
          ? 0.16
          : scene === "training"
            ? 0.65
            : 0.9;
    this.music?.gain.setTargetAtTime(
      volume,
      now,
      scene === "silent" ? 0.06 : 0.2,
    );
    if (scene === "silent" || now < this.nextBeat) return;
    const battle = scene === "battle";
    // Eighth notes; no catch-up burst after a stalled frame or background tab.
    const interval = battle ? (phase >= 2 ? 0.25 : 0.288) : 0.5;
    this.nextBeat = now + interval;
    const step = this.beat % 16,
      bar = Math.floor(this.beat / 16) % 4;
    const roots = [130.81, 103.83, 155.56, 116.54];
    const root = roots[bar];
    const note = (
      f: number,
      duration: number,
      volume: number,
      type: OscillatorType = "sine",
      end = f,
      attack = 0.02,
    ) => this.tone(f, duration, type, volume, end, 0, attack, true);
    if (step % 8 === 0) {
      // Slow minor harmony below the arpeggio, a different inversion each bar.
      [root, root * 1.1892, root * 1.4983].forEach((f) =>
        note(f, interval * 9, battle ? 0.075 : 0.11, "triangle", f, 0.35),
      );
    }
    const melody = [0, 7, 12, 10, 7, 3, 14, 12];
    if (!battle || step % 2 === 0 || phase >= 2)
      note(
        root * 2 ** (melody[step % 8] / 12) * (domain ? 2 : 1),
        battle ? 0.45 : 1.4,
        battle ? 0.16 : 0.12,
      );
    if (battle) {
      if (step % 4 === 0 || (phase >= 2 && step === 14)) {
        note(145, 0.24, 0.8, "sine", 35);
        note(root / 2, 0.65, 0.26, "triangle");
      }
      if (step % 8 === 4) {
        this.noise(0.18, 0.3, 2100, true);
        note(175, 0.1, 0.15, "triangle", 80);
      }
      if (phase > 0 || step % 2 === 0)
        this.noise(0.055, step % 2 ? 0.06 : 0.1, 8000, true);
    }
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
