import type { Hand, Point } from "../gestures";
import { TRACKING_GRACE_MS } from "./tracking";

export type HandPurpose =
  "any" | "open" | "fist" | "vortex" | "swipe" | "battle";
type Slot = {
  hand: Hand | null;
  index: number;
  side: string | null;
  palm: Point | null;
  seenAt: number;
  pose: string;
  changedAt: number;
  primed: boolean;
};
const slot = (): Slot => ({
  hand: null,
  index: -1,
  side: null,
  palm: null,
  seenAt: -Infinity,
  pose: "",
  changedAt: 0,
  primed: false,
});

/** Stable physical hands, one spell owner. A new intentional pose can take over
 * only while the current spell is idle; motion history is reset by the caller. */
export class HandRouting {
  private slots = [slot(), slot()];
  private active: number | null = null;
  private candidate = -1;
  private candidateAt = 0;
  switched = false;
  get id() {
    return this.active ?? 0;
  }
  get primed() {
    return this.slots[this.id].primed;
  }
  consumePrimer() {
    this.slots[this.id].primed = false;
  }
  reset() {
    this.slots = [slot(), slot()];
    this.active = null;
    this.candidate = -1;
    this.switched = false;
  }
  choose(
    hands: (Hand | null)[],
    sides: (string | null)[],
    now: number,
    purpose: HandPurpose = "any",
    locked = false,
    spearAvailable = false,
  ): number {
    this.switched = false;
    const present = hands
      .map((h, index) => (h ? index : -1))
      .filter((i) => i >= 0)
      .slice(0, 2);
    const cost = (id: number, index: number) => {
      const s = this.slots[id],
        h = hands[index]!,
        p = h.palm ?? h.cursor;
      const sidePenalty =
        s.side && sides[index] && s.side !== sides[index] ? 0.25 : 0;
      if (!s.palm) {
        // A new, confidently identified opposite hand gets its own slot even
        // when it appears exactly where the old spell owner disappeared.
        const knownSide = sides[index];
        return knownSide
          ? this.slots.some((track) => track.side === knownSide)
            ? 1
            : 0.1
          : 0.4;
      }
      return Math.hypot(p.x - s.palm.x, p.y - s.palm.y) + sidePenalty;
    };
    let assignment = [-1, -1];
    if (present.length === 2) {
      const [a, b] = present;
      assignment =
        cost(0, a) + cost(1, b) <= cost(0, b) + cost(1, a) ? [a, b] : [b, a];
    } else if (present.length === 1) {
      const i = present[0];
      assignment[cost(0, i) <= cost(1, i) ? 0 : 1] = i;
    }
    this.slots.forEach((s, id) => {
      s.index = assignment[id];
      s.hand = s.index < 0 ? null : hands[s.index];
      if (!s.hand || s.hand.quality) {
        if (now - s.seenAt > TRACKING_GRACE_MS) s.primed = false;
        return;
      }
      if (now - s.seenAt > TRACKING_GRACE_MS) s.primed = false;
      const h = s.hand;
      const pose = h.open
        ? "open"
        : h.extended === 0
          ? "fist"
          : h.bladeSign
            ? "blade"
            : h.spearSign
              ? "spear"
              : "other";
      if (pose !== s.pose) {
        s.pose = pose;
        s.changedAt = now;
      }
      if (h.open) s.primed = true;
      // A single handedness flicker must not rename a tracked physical hand.
      s.side ??= sides[s.index] ?? null;
      s.palm = h.palm ?? h.cursor;
      s.seenAt = now;
    });
    const score = (id: number) => {
      const s = this.slots[id],
        h = s.hand;
      if (!h || h.quality) return -1;
      if (purpose === "any") return 0;
      const freshPalm = h.open && now - s.changedAt < 800 ? 1 : 0;
      if (purpose === "fist") return h.extended === 0 ? 5 : 0;
      if (purpose === "open") return h.open ? 3 + freshPalm : 0;
      if (purpose === "swipe" && h.bladeSign) return 5;
      if (
        (purpose === "vortex" || purpose === "battle") &&
        h.extended === 0 &&
        s.primed
      )
        return 5;
      if (
        purpose === "battle" &&
        (h.bladeSign || (spearAvailable && h.spearSign))
      )
        return 5;
      return h.open ? 1 + freshPalm : 0;
    };
    const current = this.active;
    if (current !== null && locked) {
      this.candidate = -1;
      return score(current) >= 0 ? this.slots[current].index : -1;
    }
    const best = score(1) > score(0) ? 1 : 0;
    if (score(best) < 0) {
      this.candidate = -1;
      return -1;
    }
    if (current === null) {
      this.active = best;
      return this.slots[best].index;
    }
    if (score(current) < 0) {
      if (now - this.slots[current].seenAt <= TRACKING_GRACE_MS) return -1;
    } else if (best === current || score(best) <= score(current)) {
      this.candidate = -1;
      return this.slots[current].index;
    }
    if (this.candidate !== best) {
      this.candidate = best;
      this.candidateAt = now;
    }
    if (now - this.candidateAt < 120)
      return score(current) >= 0 ? this.slots[current].index : -1;
    this.active = best;
    this.switched = true;
    this.candidate = -1;
    return this.slots[best].index;
  }
}
