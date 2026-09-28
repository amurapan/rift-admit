import { expect, it } from "vitest";
import { TutorialGate } from "./tutorial";
import type { Hand } from "./gestures";

const open: Hand = {
  cursor: { x: 0.5, y: 0.5 },
  extended: 4,
  open: true,
  pinchRatio: 1,
  quality: null,
};
const fist = { ...open, extended: 0, open: false };

it("requires a complete demonstration and an intentional fist before recognizing a lesson", () => {
  const gate = new TutorialGate();
  for (let t = 0; t <= 3000; t += 50) gate.update(fist, t);
  expect(gate.phase).toBe("prepare");
  expect(gate.fistMs).toBe(0);
  for (let t = 3050; t <= 4000; t += 50) gate.update(open, t);
  expect(gate.phase).toBe("prepare");
  for (let t = 4050; t <= 4400; t += 50) gate.update(fist, t);
  expect(gate.phase).toBe("practice");
  gate.reset();
  expect(gate.phase).toBe("demo");
});

it("does not carry preparation through tracking loss or hidden-tab time", () => {
  const gate = new TutorialGate();
  for (let t = 0; t <= 3200; t += 50) gate.update(fist, t);
  expect(gate.fistMs).toBe(200);
  gate.update(null, 3250);
  expect(gate.fistMs).toBe(0);
  gate.pause();
  gate.update(fist, 100000);
  expect(gate.fistMs).toBe(0);
  expect(gate.phase).toBe("prepare");
});
