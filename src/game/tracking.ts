import { Pointer } from "./pointer";
import type { Control } from "./control";
import type { Hand, Point } from "../gestures";
/** Keep the casting hand stable when a second hand enters or leaves the frame. */
export class CastingHand {
  private side: string | null = null;
  private palm: Point | null = null;
  reset() {
    this.side = null;
    this.palm = null;
  }
  choose(hands: (Hand | null)[], sides: (string | null)[] = []): number {
    if (!hands.length) {
      this.reset();
      return -1;
    }
    let index = 0;
    if (this.side && sides.some(Boolean)) {
      const match = sides.indexOf(this.side);
      if (match < 0) {
        this.reset();
        return -1;
      } // One invalid frame safely cancels the pending spell.
      index = match;
    } else if (this.palm && hands.length > 1) {
      const d = (h: Hand | null) =>
        h
          ? Math.hypot(
              (h.palm ?? h.cursor).x - this.palm!.x,
              (h.palm ?? h.cursor).y - this.palm!.y,
            )
          : Infinity;
      if (d(hands[1]) < d(hands[0])) index = 1;
    }
    const hand = hands[index];
    this.palm = hand?.palm ?? hand?.cursor ?? null;
    this.side = sides[index] ?? null;
    return index;
  }
}

/** Presentation follows fresh samples, with bounded prediction between them. */
export class CursorFollower {
  private first: Pointer | null = null;
  private second: Pointer | null = null;
  reset() {
    this.first = this.second = null;
  }
  sample(input: Control, timestamp: number) {
    if (!input.valid) {
      this.reset();
      return;
    }
    this.first ??= new Pointer();
    this.first.sample(input.position, timestamp);
    if (input.secondPosition) {
      this.second ??= new Pointer();
      this.second.sample(input.secondPosition, timestamp);
    } else this.second = null;
  }
  draw(input: Control, now: number): Control {
    if (!input.valid) {
      this.reset();
      return input;
    }
    return {
      ...input,
      position: this.first?.draw(now) ?? input.position,
      secondPosition: input.secondPosition
        ? (this.second?.draw(now) ?? input.secondPosition)
        : null,
    };
  }
}
