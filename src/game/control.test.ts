import { expect, it } from "vitest";
import {
  Calibrator,
  DEFAULT_CALIBRATION,
  MotionControl,
  mapped,
} from "./control";
import type { Hand } from "../gestures";
const hand = (x = 0.5, y = 0.5, props: Partial<Hand> = {}): Hand => ({
  palm: { x, y },
  cursor: { x, y },
  extended: 4,
  open: true,
  pinchRatio: 1,
  quality: null,
  ...props,
});
it("does not interpret finger opening as a throw or a slash", () => {
  const motion = new MotionControl();
  motion.update(
    hand(0.5, 0.5, { open: false, pinchRatio: 0.2 }),
    null,
    100,
    DEFAULT_CALIBRATION,
  );
  const result = motion.update(
    hand(0.5, 0.5, { cursor: { x: 0.1, y: 0.2 } }),
    null,
    200,
    DEFAULT_CALIBRATION,
  );
  expect(result.released).toBe(true);
  expect(result.velocity).toEqual({ x: 0, y: 0 });
  expect(result.slash).toBeNull();
});
it("recognizes deliberate movement and suppresses duplicate cuts", () => {
  const motion = new MotionControl();
  motion.update(hand(0.3, 0.5), null, 100, DEFAULT_CALIBRATION);
  motion.update(hand(0.35, 0.5), null, 150, DEFAULT_CALIBRATION);
  expect(
    motion.update(hand(0.45, 0.5), null, 250, DEFAULT_CALIBRATION).slash,
  ).not.toBeNull();
  expect(
    motion.update(hand(0.55, 0.5), null, 300, DEFAULT_CALIBRATION).slash?.id,
  ).toBe(250);
});
it("tracking loss never synthesizes a release", () => {
  const motion = new MotionControl();
  motion.update(
    hand(0.5, 0.5, { pinchRatio: 0.1 }),
    null,
    100,
    DEFAULT_CALIBRATION,
  );
  motion.update(null, null, 150, DEFAULT_CALIBRATION);
  expect(motion.update(hand(), null, 200, DEFAULT_CALIBRATION).released).toBe(
    false,
  );
});
it("opening a previously closed moving hand does not create an accidental cut", () => {
  const motion = new MotionControl();
  motion.update(
    hand(0.5, 0.5, { open: false, extended: 0 }),
    null,
    100,
    DEFAULT_CALIBRATION,
  );
  motion.update(
    hand(0.5, 0.5, { open: false, extended: 0 }),
    null,
    180,
    DEFAULT_CALIBRATION,
  );
  expect(
    motion.update(hand(0.3, 0.3), null, 250, DEFAULT_CALIBRATION).slash,
  ).toBeNull();
  expect(
    motion.update(hand(0.3, 0.3), null, 330, DEFAULT_CALIBRATION).slash,
  ).toBeNull();
});
it("only nearby open palms form the secret pose", () => {
  const motion = new MotionControl();
  expect(
    motion.update(hand(0.4, 0.5), hand(0.55, 0.5), 100, DEFAULT_CALIBRATION)
      .domainPose,
  ).toBe(true);
  expect(
    motion.update(hand(0.4, 0.5), hand(0.85, 0.5), 200, DEFAULT_CALIBRATION)
      .domainPose,
  ).toBe(false);
});
it("calibrates to comfortable motion and requires both horizontal and vertical coverage", () => {
  const calibration = new Calibrator();
  for (let i = 0; i < 40; i++)
    calibration.update(hand(0.3 + (i % 2) * 0.4, 0.5), 50);
  expect(calibration.ready).toBe(false);
  calibration.update(hand(0.5, 0.3), 50);
  calibration.update(hand(0.5, 0.7), 50);
  expect(calibration.ready).toBe(true);
  const bounds = calibration.finish();
  const center = mapped({ x: 0.5, y: 0.5 }, bounds);
  expect(center.x).toBeCloseTo(0.5);
  expect(center.y).toBeCloseTo(0.5);
});
