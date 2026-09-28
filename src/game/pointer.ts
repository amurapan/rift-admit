import type { Point } from "../gestures";
import { clamp } from "./control";

/** A short, bounded visual prediction. Never used to recognize or cast a spell. */
export class Pointer {
  private target: Point | null = null;
  private shown: Point | null = null;
  private velocity: Point = { x: 0, y: 0 };
  private sampleAt = -Infinity;
  private drawnAt = 0;
  private interval = 33;
  constructor(private maxLead = 0.03) {}
  sample(point: Point, timestamp: number) {
    const elapsed = timestamp - this.sampleAt;
    const dx = this.target ? point.x - this.target.x : 0;
    const dy = this.target ? point.y - this.target.y : 0;
    if (!this.target || elapsed > 250 || Math.hypot(dx, dy) > 0.3) {
      this.shown = { ...point };
      this.velocity = { x: 0, y: 0 };
    } else if (elapsed > 0) {
      this.interval = this.interval * 0.5 + elapsed * 0.5;
      // Do not turn tiny landmark jitter into a moving cursor.
      const moving = Math.hypot(dx, dy) > 0.003;
      this.velocity = moving
        ? { x: dx / elapsed, y: dy / elapsed }
        : { x: 0, y: 0 };
    }
    this.target = { ...point };
    this.sampleAt = timestamp;
  }
  draw(now: number): Point {
    if (!this.target || !this.shown) return { x: 0.5, y: 0.5 };
    const age = Math.max(0, now - this.sampleAt);
    // A lost/slow detector must never make the hand continue travelling.
    const horizon = age < 180 ? Math.min(age, 60) : 0;
    let dx = this.velocity.x * horizon,
      dy = this.velocity.y * horizon;
    const amount = Math.hypot(dx, dy);
    if (amount > this.maxLead) {
      dx *= this.maxLead / amount;
      dy *= this.maxLead / amount;
    }
    const moving = Math.hypot(this.velocity.x, this.velocity.y) > 0.00015;
    const dt = this.drawnAt ? Math.max(0, now - this.drawnAt) : 16;
    const smoothingMs = moving ? clamp(this.interval * 0.35, 8, 50) : 20;
    const alpha = 1 - Math.exp(-dt / smoothingMs);
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
