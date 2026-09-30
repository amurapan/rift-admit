import { expect, it } from "vitest";
import type { Hand } from "../gestures";
import { HandRouting } from "./hand-routing";
import { Ritual } from "./ritual";
import { MotionControl, DEFAULT_CALIBRATION } from "./control";
const hand = (x: number, pose = "open"): Hand => ({
  palm: { x, y: 0.5 },
  cursor: { x, y: 0.5 },
  open: pose === "open",
  extended: pose === "fist" ? 0 : pose === "sign" ? 2 : 4,
  bladeSign: pose === "sign",
  pinchRatio: 1,
  quality: null,
});
const sides = ["Left", "Right"];
it("lets the second hand claim a lesson with its deliberate sign", () => {
  const r = new HandRouting();
  expect(r.choose([hand(0.3), hand(0.7)], sides, 100, "swipe")).toBe(0);
  for (const t of [150, 200, 250])
    expect(r.choose([hand(0.3), hand(0.7, "sign")], sides, t, "swipe")).toBe(0);
  expect(r.choose([hand(0.3), hand(0.7, "sign")], sides, 300, "swipe")).toBe(1);
  expect(r.switched).toBe(true);
  expect(r.id).toBe(1);
});
it("never switches a locked spell to the second open palm, even after owner loss", () => {
  const r = new HandRouting();
  r.choose([hand(0.3), hand(0.7)], sides, 100);
  for (const t of [150, 500, 1000])
    expect(r.choose([hand(0.7)], ["Right"], t, "battle", true)).toBe(-1);
  expect(
    r.choose([hand(0.3, "fist"), hand(0.7)], sides, 1050, "battle", true),
  ).toBe(0);
  expect(r.switched).toBe(false);
});
it("a detector order change or a transient label swap does not move the spell owner", () => {
  const r = new HandRouting();
  r.choose([hand(0.25), hand(0.75)], sides, 100);
  expect(
    r.choose([hand(0.75), hand(0.25)], ["Right", "Left"], 150, "battle", true),
  ).toBe(1);
  expect(r.id).toBe(0);
  expect(
    r.choose([hand(0.25), hand(0.75)], ["Right", "Left"], 200, "battle", true),
  ).toBe(0);
  expect(r.switched).toBe(false);
});
it("the second hand can take over a shield with a fresh open palm", () => {
  const r = new HandRouting();
  r.choose([hand(0.3), hand(0.7, "fist")], sides, 100, "open");
  r.choose([hand(0.3), hand(0.7, "fist")], sides, 1000, "open");
  r.choose([hand(0.3), hand(0.7)], sides, 1050, "open");
  expect(r.choose([hand(0.3), hand(0.7)], sides, 1200, "open")).toBe(1);
  expect(r.switched).toBe(true);
});
it("preserves the second hand's observed palm for compression and clears motion on handover", () => {
  const r = new HandRouting(),
    m = new MotionControl(),
    magic = new Ritual();
  r.choose([hand(0.25), hand(0.75)], sides, 100, "vortex");
  m.update(hand(0.25), hand(0.75), 100, DEFAULT_CALIBRATION);
  r.choose([hand(0.25), hand(0.75, "fist")], sides, 150, "vortex");
  expect(r.choose([hand(0.25), hand(0.75, "fist")], sides, 300, "vortex")).toBe(
    1,
  );
  expect(r.primed).toBe(true);
  m.reset();
  magic.pause();
  magic.primeCompression();
  const c = m.update(hand(0.75, "fist"), hand(0.25), 300, DEFAULT_CALIBRATION);
  expect(c.slash).toBeNull();
  expect(c.velocity).toEqual({ x: 0, y: 0 });
  for (let i = 0; i < 10; i++) magic.update(c, 50, 30, "vortex");
  expect(magic.vortex).not.toBeNull();
  expect(magic.ownsHand).toBe(true);
  r.consumePrimer();
  expect(r.primed).toBe(false);
});
it("never borrows a palm from the other hand to prime a fist", () => {
  const r = new HandRouting();
  for (let t = 100; t <= 1000; t += 50)
    expect(r.choose([hand(0.3), hand(0.7, "fist")], sides, t, "vortex")).toBe(
      0,
    );
  r.reset();
  expect(r.choose([hand(0.7, "fist")], ["Right"], 1100, "vortex")).toBe(0);
  expect(r.primed).toBe(false);
});
