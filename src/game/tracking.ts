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
