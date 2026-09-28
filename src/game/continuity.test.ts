import { expect, it } from "vitest";
import { Arena } from "./arena";
import { emptyControl, type Control } from "./control";
import { TrackingContinuity, CursorFollower } from "./tracking";
const pose = (extra: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...extra,
});
const open = pose({ open: true });
const fist = pose({ fist: true });
function charged() {
  const world = new Arena("vortex");
  const tracking = new TrackingContinuity();
  world.tick(50, tracking.update(open, 0));
  for (let t = 50; t <= 1500; t += 50) world.tick(50, tracking.update(fist, t));
  expect(world.magic.charge).toBeGreaterThan(0.6);
  return { world, tracking };
}
it("holds presentation across short gaps without charging or simulating gameplay", () => {
  const { world, tracking } = charged();
  const charge = world.magic.charge,
    elapsed = world.elapsed;
  const missing = tracking.update(emptyControl(), 1550);
  expect(missing.valid).toBe(false);
  expect(missing.trackingGrace).toBe(true);
  world.tick(200, missing);
  expect(world.paused).toBe(false);
  expect(world.elapsed).toBe(elapsed);
  expect(world.magic.charge).toBe(charge);
  world.tick(16, tracking.update(fist, 1700));
  expect(world.magic.charge).toBeGreaterThan(charge);
  expect(world.stats.bursts).toBe(0);
  world.tick(16, tracking.update(open, 1750));
  expect(world.stats.bursts).toBe(1);
});
it("never casts a release hidden by missing measurements", () => {
  const { world, tracking } = charged();
  world.tick(50, tracking.update(emptyControl(), 1550));
  const recovered = tracking.update(open, 1700);
  expect(recovered.trackingInterrupted).toBe(true);
  world.tick(16, recovered);
  expect(world.stats.bursts).toBe(0);
  expect(world.magic.vortex).toBeNull();
});
it("expires even when no further measurements arrive and explicit reset is immediate", () => {
  const { world, tracking } = charged();
  const missing = tracking.update(emptyControl(), 1550);
  const expired = tracking.expire(missing, 1801);
  expect(expired.trackingGrace).toBeFalsy();
  world.tick(16, expired);
  expect(world.paused).toBe(true);
  expect(world.magic.vortex).toBeNull();
  tracking.reset();
  expect(tracking.update(emptyControl(), 1810).trackingGrace).toBeFalsy();
});
it("a distant reacquisition cannot bridge a drawing path or release a spell", () => {
  const t = new TrackingContinuity();
  t.update(pose({ pinching: true, position: { x: 0.2, y: 0.5 } }), 100);
  t.update(emptyControl(), 150);
  expect(
    t.update(pose({ pinching: true, position: { x: 0.8, y: 0.5 } }), 200)
      .trackingInterrupted,
  ).toBe(true);
});
it("keeps a neutral visual cursor during grace, then removes it on confirmed loss", () => {
  const t = new TrackingContinuity(),
    follower = new CursorFollower();
  const active = pose({ position: { x: 0.3, y: 0.4 }, pinching: true });
  follower.sample(t.update(active, 100), 100);
  follower.draw(active, 100);
  const missing = t.update(emptyControl(), 150);
  follower.sample(missing, 150);
  const visual = follower.draw(missing, 160);
  expect(visual.valid).toBe(true);
  expect(visual.position).toEqual(active.position);
  expect(visual.pinching).toBe(false);
  expect(missing.valid).toBe(false);
  expect(follower.draw(t.expire(missing, 401), 401).valid).toBe(false);
});

it("preserves an unfinished circle across a nearby same-pose reacquisition", () => {
  const world = new Arena("domain"),
    tracking = new TrackingContinuity();
  const palms = pose({
    open: true,
    twoHands: true,
    secondOpen: true,
    domainPose: true,
  });
  for (let t = 0; t <= 750; t += 50) world.tick(50, tracking.update(palms, t));
  expect(world.magic.stage).toBe("draw");
  const pinch = pose({ pinching: true, position: { x: 0.7, y: 0.5 } });
  world.tick(50, tracking.update(pinch, 800));
  world.tick(
    50,
    tracking.update({ ...pinch, position: { x: 0.68, y: 0.52 } }, 850),
  );
  const path = [...world.magic.path];
  world.tick(100, tracking.update(emptyControl(), 900));
  expect(world.magic.path).toEqual(path);
  expect(world.magic.drawing).toBe(true);
  world.tick(
    16,
    tracking.update({ ...pinch, position: { x: 0.65, y: 0.54 } }, 1000),
  );
  expect(world.magic.path.slice(0, path.length)).toEqual(path);
  expect(world.magic.path.length).toBe(path.length + 1);
  expect(world.magic.stage).toBe("draw");
});
