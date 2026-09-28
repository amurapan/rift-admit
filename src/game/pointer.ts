import type { Point } from "../gestures";
import { clamp } from "./control";

/** A short, bounded visual prediction. Never used to recognize or cast a spell. */
export class Pointer {
  private target: Point | null = null;
  private measured: Point | null = null;
  private shown: Point | null = null;
  private velocity: Point = { x: 0, y: 0 };
  private sampleAt = -Infinity;
  private drawnAt = 0;
  constructor(private maxLead = 0.018) {}
  sample(point: Point, timestamp: number) {
    const elapsed = timestamp - this.sampleAt;
    const dx = this.measured ? point.x - this.measured.x : 0;
    const dy = this.measured ? point.y - this.measured.y : 0;
    if (!this.target || elapsed > 600) {
      this.shown = { ...point };
      this.target = { ...point };
      this.velocity = { x: 0, y: 0 };
    } else if (elapsed > 0) {
      // Filter stationary noise strongly, but respond quickly to deliberate
      // movement. The time-based coefficients also work at low detector rates.
      const speed = (Math.hypot(dx, dy) / elapsed) * 1000;
      const tau = clamp(110 / (1 + (speed / 0.25) ** 2), 12, 110);
      const alpha = 1 - Math.exp(-elapsed / tau);
      const next = {
        x: this.target.x + (point.x - this.target.x) * alpha,
        y: this.target.y + (point.y - this.target.y) * alpha,
      };
      const moving = Math.hypot(dx, dy) > 0.01 && elapsed < 250;
      this.velocity = moving
        ? {
            x: (next.x - this.target.x) / elapsed,
            y: (next.y - this.target.y) / elapsed,
          }
        : { x: 0, y: 0 };
      this.target = next;
    }
    this.measured = { ...point };
    this.sampleAt = timestamp;
  }
  draw(now: number): Point {
    if (!this.target || !this.shown) return { x: 0.5, y: 0.5 };
    const age = Math.max(0, now - this.sampleAt);
    // A lost/slow detector must never make the hand continue travelling.
    // Fade prediction gradually; a hard timeout caused a visible backwards jump.
    const horizon = Math.min(age, 45) * Math.exp(-Math.max(0, age - 90) / 65);
    let dx = this.velocity.x * horizon,
      dy = this.velocity.y * horizon;
    const amount = Math.hypot(dx, dy);
    if (amount > this.maxLead) {
      dx *= this.maxLead / amount;
      dy *= this.maxLead / amount;
    }
    const dt = this.drawnAt ? Math.max(0, now - this.drawnAt) : 16;
    const alpha = 1 - Math.exp(-dt / 38);
    this.drawnAt = now;
    this.shown = {
      x: clamp(this.shown.x + (this.target.x + dx - this.shown.x) * alpha),
      y: clamp(this.shown.y + (this.target.y + dy - this.shown.y) * alpha),
    };
    return this.shown;
  }
}

/** Stable slots (casting hand first), updated on samples and drawn at display rate. */
export class HandOverlay {
  private hands: Pointer[][] = [];
  sample(hands: Point[][], timestamp: number) {
    this.hands = hands.map((hand, h) =>
      hand.map((point, i) => {
        const pointer = this.hands[h]?.[i] ?? new Pointer(0.015);
        pointer.sample(point, timestamp);
        return pointer;
      }),
    );
  }
  draw(now: number) {
    return this.hands.map((hand) => hand.map((point) => point.draw(now)));
  }
  reset() {
    this.hands = [];
  }
}
