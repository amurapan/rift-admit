import { Pointer } from "./pointer";
import { distance, emptyControl, type Control } from "./control";
import type { Hand, Point } from "../gestures";
export const TRACKING_GRACE_MS = 300;

/** Keep a short gap distinct from a measured gesture or a confirmed loss. */
export class TrackingContinuity {
  private previous: Control | null = null;
  private seenAt = -Infinity;
  private missing = false;
  reset() {
    this.previous = null;
    this.seenAt = -Infinity;
    this.missing = false;
  }
  update(input: Control, now: number): Control {
    if (!input.valid) {
      this.missing = true;
      if (this.previous && now - this.seenAt <= TRACKING_GRACE_MS)
        return { ...input, trackingGrace: true, quality: null };
      return input;
    }
    const previous = this.previous;
    const interrupted =
      this.missing &&
      !!previous &&
      (now - this.seenAt > TRACKING_GRACE_MS ||
        distance(input.position, previous.position) > 0.12 ||
        (
          [
            "open",
            "fist",
            "pinching",
            "bladeSign",
            "spearSign",
            "bindPose",
            "secondFist",
            "twoHands",
            "secondOpen",
            "secondSign",
          ] as const
        ).some((key) => input[key] !== previous[key]));
    this.previous = input;
    this.seenAt = now;
    this.missing = false;
    // A pose change hidden by a gap must not release a stored spell or cut.
    return interrupted
      ? { ...input, trackingInterrupted: true, released: false, slash: null }
      : input;
  }
  expire(input: Control, now: number): Control {
    return input.trackingGrace && now - this.seenAt > TRACKING_GRACE_MS
      ? { ...emptyControl(), quality: "Покажи руку целиком — время на паузе" }
      : input;
  }
}
/** Keep the casting hand stable when a second hand enters or leaves the frame. */
export class CastingHand {
  private side: string | null = null;
  private palm: Point | null = null;
  private seenAt = -Infinity;
  reset() {
    this.side = null;
    this.palm = null;
    this.seenAt = -Infinity;
  }
  choose(
    hands: (Hand | null)[],
    sides: (string | null)[] = [],
    now = performance.now(),
  ): number {
    if (now - this.seenAt > TRACKING_GRACE_MS) this.reset();
    if (!hands.length) {
      return -1;
    }
    let index = 0;
    if (this.side && sides.some(Boolean)) {
      const match = sides.indexOf(this.side);
      if (match < 0) {
        return -1;
      }
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
    this.side = sides[index] ?? this.side;
    this.seenAt = now;
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
      if (!input.trackingGrace) this.reset();
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
      if (input.trackingGrace && this.first)
        return {
          ...emptyControl(),
          handId: input.handId,
          valid: true,
          position: this.first.draw(now),
          secondPosition: this.second?.draw(now) ?? null,
          twoHands: !!this.second,
        };
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
