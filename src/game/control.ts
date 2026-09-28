import type { Hand, Point } from "../gestures";

export type Calibration = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};
export const DEFAULT_CALIBRATION: Calibration = {
  minX: 0.2,
  maxX: 0.8,
  minY: 0.23,
  maxY: 0.77,
};
export type Slash = { from: Point; to: Point; id?: number };
export type Control = {
  valid: boolean;
  open: boolean;
  fist: boolean;
  bladeSign: boolean;
  twoHands: boolean;
  secondOpen: boolean;
  dualSign: boolean;
  handGap: number;
  secondPosition: Point | null;
  position: Point;
  velocity: Point;
  pinching: boolean;
  released: boolean;
  shield: boolean;
  slash: Slash | null;
  domainPose: boolean;
  quality: string | null;
  extended: number;
};
export const emptyControl = (): Control => ({
  valid: false,
  open: false,
  fist: false,
  bladeSign: false,
  twoHands: false,
  secondOpen: false,
  dualSign: false,
  handGap: 0,
  secondPosition: null,
  position: { x: 0.5, y: 0.6 },
  velocity: { x: 0, y: 0 },
  pinching: false,
  released: false,
  shield: false,
  slash: null,
  domainPose: false,
  quality: null,
  extended: 0,
});
export const clamp = (n: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, n));
export const length = (p: Point) => Math.hypot(p.x, p.y * 0.7);
export const distance = (a: Point, b: Point) =>
  length({ x: a.x - b.x, y: a.y - b.y });

export function mapped(point: Point, calibration: Calibration): Point {
  return {
    x: clamp(
      (point.x - calibration.minX) / (calibration.maxX - calibration.minX),
      0.025,
      0.975,
    ),
    y: clamp(
      (point.y - calibration.minY) / (calibration.maxY - calibration.minY),
      0.025,
      0.975,
    ),
  };
}

export class MotionControl {
  private samples: { point: Point; time: number }[] = [];
  private pinched = false;
  private openSince = 0;
  private lastSlash = -10000;
  private lastTime = 0;
  private stroke: { from: Point; until: number; id: number } | null = null;
  reset() {
    this.samples = [];
    this.pinched = false;
    this.openSince = 0;
    this.lastTime = 0;
    this.stroke = null;
  }

  update(
    hand: Hand | null,
    second: Hand | null,
    now: number,
    calibration: Calibration,
  ): Control {
    if (!hand || hand.quality) {
      this.reset();
      return {
        ...emptyControl(),
        quality: hand?.quality ?? "Покажи руку целиком — время на паузе",
      };
    }
    if (this.lastTime && now - this.lastTime > 250) this.reset();
    this.lastTime = now;
    // Palm position is stable when fingers open/close; fingertip cursors would
    // create false throw velocities and cuts during a gesture change.
    const point = mapped(hand.palm ?? hand.cursor, calibration);
    const previous = this.pinched;
    this.pinched =
      hand.extended > 0 && hand.pinchRatio < (previous ? 0.44 : 0.29);
    const released = previous && !this.pinched;
    this.samples.push({ point, time: now });
    this.samples = this.samples.filter((sample) => now - sample.time <= 220);
    const reference =
      this.samples.find((sample) => now - sample.time <= 150) ??
      this.samples[0];
    const seconds = Math.max(0.025, (now - reference.time) / 1000);
    const velocity = {
      x: clamp((point.x - reference.point.x) / seconds, -4, 4),
      y: clamp((point.y - reference.point.y) / seconds, -4, 4),
    };
    const cutting = hand.open || !!hand.bladeSign;
    if (cutting) this.openSince ||= now;
    else this.openSince = 0;
    let slash: Slash | null =
      this.stroke && now < this.stroke.until && cutting && !released
        ? { from: this.stroke.from, to: point, id: this.stroke.id }
        : null;
    if (cutting && !released && now - this.lastSlash > 340) {
      const start = this.samples.find((sample) => {
        const elapsed = (now - sample.time) / 1000;
        return (
          sample.time >= this.openSince &&
          elapsed >= 0.075 &&
          distance(point, sample.point) >= 0.16 &&
          distance(point, sample.point) / elapsed > 0.8
        );
      });
      if (start) {
        this.stroke = { from: start.point, until: now + 220, id: now };
        slash = { from: start.point, to: point, id: now };
        this.lastSlash = now;
        this.samples = [{ point, time: now }];
      }
    }
    const domainPose =
      !!second?.open &&
      !second.quality &&
      hand.open &&
      distance(hand.palm ?? hand.cursor, second.palm ?? second.cursor) < 0.19;
    const twoHands = !!second && !second.quality;
    const handGap = twoHands
      ? distance(hand.palm ?? hand.cursor, second!.palm ?? second!.cursor)
      : 0;
    return {
      valid: true,
      open: hand.open,
      fist: hand.extended === 0 && !this.pinched,
      bladeSign: !!hand.bladeSign,
      twoHands,
      secondOpen: twoHands && !!second?.open,
      dualSign:
        twoHands &&
        !!hand.bladeSign &&
        !!second?.bladeSign &&
        handGap > 0.08 &&
        handGap < 0.28,
      handGap,
      secondPosition: twoHands
        ? mapped(second!.palm ?? second!.cursor, calibration)
        : null,
      position: point,
      velocity,
      pinching: this.pinched,
      released,
      shield:
        hand.open &&
        now - this.openSince >= 140 &&
        length(velocity) < 1.4 &&
        !slash,
      slash,
      domainPose,
      quality: null,
      extended: hand.extended,
    };
  }
}

export class Calibrator {
  bounds = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
  samples = 0;
  fistMs = 0;
  get ready() {
    return (
      this.samples >= 30 &&
      this.bounds.maxX - this.bounds.minX > 0.2 &&
      this.bounds.maxY - this.bounds.minY > 0.14
    );
  }
  update(hand: Hand | null, dt: number) {
    if (!hand || hand.quality) {
      this.fistMs = 0;
      return;
    }
    const p = hand.palm ?? hand.cursor;
    if (hand.open) {
      this.bounds.minX = Math.min(this.bounds.minX, p.x);
      this.bounds.maxX = Math.max(this.bounds.maxX, p.x);
      this.bounds.minY = Math.min(this.bounds.minY, p.y);
      this.bounds.maxY = Math.max(this.bounds.maxY, p.y);
      this.samples++;
    }
    this.fistMs =
      this.ready && hand.extended === 0 ? this.fistMs + Math.min(dt, 100) : 0;
  }
  finish(): Calibration {
    if (!this.ready) return { ...DEFAULT_CALIBRATION };
    return {
      minX: this.bounds.minX - 0.025,
      maxX: this.bounds.maxX + 0.025,
      minY: this.bounds.minY - 0.025,
      maxY: this.bounds.maxY + 0.025,
    };
  }
}
