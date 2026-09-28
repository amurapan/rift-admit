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
