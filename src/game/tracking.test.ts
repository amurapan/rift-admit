import { expect, it } from "vitest";
import { CastingHand } from "./tracking";
import type { Hand } from "../gestures";
const hand = (x: number): Hand => ({
  cursor: { x, y: 0.5 },
  palm: { x, y: 0.5 },
  extended: 4,
  pinchRatio: 1,
  open: true,
  quality: null,
});
it("follows the same casting hand even when detector order changes", () => {
  const t = new CastingHand();
  expect(t.choose([hand(0.3)], ["Left"])).toBe(0);
  expect(t.choose([hand(0.7), hand(0.3)], ["Right", "Left"])).toBe(1);
});
it("losing the casting hand never substitutes the other open palm for a release", () => {
  const t = new CastingHand();
  t.choose([hand(0.3), hand(0.7)], ["Left", "Right"]);
  expect(t.choose([hand(0.7)], ["Right"])).toBe(-1);
  expect(t.choose([hand(0.7)], ["Right"])).toBe(0);
});

import { CursorFollower } from "./tracking";
import { emptyControl } from "./control";
it("smooths visible motion without changing gesture data or replaying a lost cursor", () => {
  const follower = new CursorFollower();
  const first = {
    ...emptyControl(),
    valid: true,
    position: { x: 0.2, y: 0.5 },
  };
  follower.update(first, 16);
  const next = { ...first, position: { x: 0.8, y: 0.5 }, pinching: true };
  const visual = follower.update(next, 16);
  expect(visual.position.x).toBeGreaterThan(0.2);
  expect(visual.position.x).toBeLessThan(0.8);
  expect(visual.pinching).toBe(true);
  expect(next.position.x).toBe(0.8);
  follower.update(emptyControl(), 16);
  expect(follower.update(next, 16).position.x).toBe(0.8);
});
