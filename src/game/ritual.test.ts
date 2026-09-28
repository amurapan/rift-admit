import { describe, expect, it } from "vitest";
import { Awakening, Ritual, inspectCircle } from "./ritual";
import { emptyControl, type Control } from "./control";
const input = (o: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...o,
});
const open = input({ open: true });
const circle = (fraction = 1) =>
  Array.from({ length: 65 }, (_, i) => ({
    x: 0.5 + Math.cos((i / 64) * Math.PI * 2 * fraction) * 0.22,
    y: 0.5 + (Math.sin((i / 64) * Math.PI * 2 * fraction) * 0.22) / 0.7,
  }));
function hold(r: Ritual, c: Control, ms: number, energy = 100) {
  let result = {};
  for (let t = 0; t < ms; t += 50) result = r.update(c, 50, energy);
  return result;
}
function prime(r: Ritual) {
  hold(
    r,
    input({ twoHands: true, open: true, secondOpen: true, domainPose: true }),
    750,
  );
}
function draw(r: Ritual, path = circle(), allowed: string | null = null) {
  for (const p of path)
    r.update(input({ pinching: true, position: p }), 40, 100, allowed);
  r.update(open, 40, 100, allowed);
}
describe("spell rituals", () => {
  it("tolerates brief recognition flicker without counting missing or incorrect poses as hold time", () => {
    const pose = input({ twoHands: true, open: true, secondOpen: true, domainPose: true });
    for (const missing of [emptyControl(), input({ twoHands: true, open: true, secondOpen: false })]) {
      const r = new Ritual();
      hold(r, pose, 600);
      hold(r, missing, 150);
      expect(r.domainHold).toBe(600);
      expect(r.stage).toBe("idle");
      r.update(pose, 50, 100);
      expect(r.stage).toBe("idle");
      r.update(pose, 50, 100);
      expect(r.stage).toBe("draw");
    }
  });
  it("resets the initial hold after sustained tracking loss or an explicit pause", () => {
    const pose = input({ domainPose: true });
    const r = new Ritual();
    hold(r, pose, 600);
    for (let i = 0; i < 5; i++) r.pause(50);
    expect(r.domainHold).toBe(0);
    r.update(pose, 100, 100);
    expect(r.stage).toBe("idle");
    r.pause();
    expect(r.domainHold).toBe(0);
  });
  it("requires a neutral open palm before compression, so the tutorial fist cannot cast", () => {
    const r = new Ritual();
    hold(r, input({ fist: true }), 1200);
    expect(r.vortex).toBeNull();
    r.update(open, 50, 0);
    hold(r, input({ fist: true }), 1400, 0);
    expect(r.charge).toBeGreaterThan(0.6);
    expect(r.update(open, 50, 0).burst).toBeDefined();
    expect(r.update(open, 50, 0).burst).toBeUndefined();
  });
  it("gives a specific correction for an early release", () => {
    const r = new Ritual();
    r.update(open, 50, 0);
    hold(r, input({ fist: true }), 400, 0);
    expect(r.update(open, 50, 0).burst).toBeUndefined();
    expect(r.hint).toContain("Слишком рано");
  });
  it("tracking loss cancels charged magic and never casts on return", () => {
    const r = new Ritual();
    r.update(open, 50, 0);
    hold(r, input({ fist: true }), 1500, 0);
    r.update(emptyControl(), 50, 0);
    expect(r.update(open, 50, 0).burst).toBeUndefined();
    expect(r.vortex).toBeNull();
  });
  it("requires the two-finger sign before a cut", () => {
    const r = new Ritual(),
      slash = { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, id: 1 };
    expect(r.update(input({ slash }), 50, 0).slash).toBeUndefined();
    expect(r.hint).toContain("два пальца");
    hold(r, input({ bladeSign: true }), 350, 0);
    expect(r.update(input({ slash }), 50, 0).slash).toEqual(slash);
  });
  it("accepts approximate circles in either direction and rejects open arcs and scribbles", () => {
    expect(inspectCircle(circle()).ok).toBe(true);
    expect(inspectCircle(circle().reverse()).ok).toBe(true);
    expect(inspectCircle(circle(0.7)).hint).toContain("Соедини");
    expect(
      inspectCircle(
        circle().map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.1, y: p.y })),
      ).ok,
    ).toBe(false);
    expect(
      inspectCircle(
        Array.from({ length: 65 }, (_, i) => ({
          x: 0.5 + 0.2 * Math.cos(i),
          y: 0.5 + 0.2 * Math.sin(i * 2),
        })),
      ).ok,
    ).toBe(false);
  });
  it("a long moving stroke must settle into a new sign before it can cast twice", () => {
    const r = new Ritual();
    hold(r, input({ bladeSign: true }), 350, 0);
    const moving = input({
      bladeSign: true,
      velocity: { x: 1.2, y: 0 },
      slash: { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, id: 1 },
    });
    expect(r.update(moving, 50, 0).slash).toBeDefined();
    hold(r, { ...moving, slash: null }, 400, 0);
    expect(
      r.update({ ...moving, slash: { ...moving.slash!, id: 2 } }, 50, 0).slash,
    ).toBeUndefined();
    hold(r, input({ bladeSign: true }), 350, 0);
    expect(
      r.update({ ...moving, slash: { ...moving.slash!, id: 3 } }, 50, 0).slash,
    ).toBeDefined();
  });
  it("requires energy, initial pose, a complete circle and a deliberate two-hand release", () => {
    const r = new Ritual();
    hold(r, input({ domainPose: true }), 1500, 90);
    expect(r.stage).toBe("idle");
    prime(r);
    expect(r.stage).toBe("draw");
    draw(r, circle(0.7));
    expect(r.stage).toBe("draw");
    expect(r.hint).toContain("Соедини");
    draw(r);
    expect(r.stage).toBe("release");
    hold(r, open, 700);
    expect(r.stage).toBe("release");
    hold(r, input({ open: true, secondOpen: true, handGap: 0.4 }), 350);
    expect(
      r.update(input({ open: true, secondOpen: true, handGap: 0.4 }), 50, 100)
        .domain,
    ).toBe(true);
    expect(r.stage).toBe("idle");
  });
  it("does not close a drawing when tracking is lost", () => {
    const r = new Ritual();
    prime(r);
    for (const p of circle().slice(0, 20))
      r.update(input({ pinching: true, position: p }), 40, 100);
    r.update(emptyControl(), 50, 100);
    expect(r.stage).toBe("draw");
    expect(r.path).toHaveLength(0);
    expect(r.update(open, 50, 100).domain).toBeUndefined();
    draw(r);
    expect(r.stage).toBe("release");
  });
  it("keeps a completed circle on pause but requires a fresh two-hand release", () => {
    const r = new Ritual();
    prime(r);
    draw(r);
    hold(r, input({ open: true, secondOpen: true, handGap: 0.4 }), 200);
    r.update(emptyControl(), 50, 100);
    expect(r.stage).toBe("release");
    expect(r.circle?.ok).toBe(true);
    expect(r.releaseHold).toBe(0);
    expect(
      r.update(input({ open: true, secondOpen: true, handGap: 0.4 }), 200, 100)
        .domain,
    ).toBeUndefined();
    expect(
      r.update(input({ open: true, secondOpen: true, handGap: 0.4 }), 200, 100)
        .domain,
    ).toBe(true);
  });
  it("lets a novice take their time drawing during the territory lesson", () => {
    const r = new Ritual();
    prime(r);
    for (let t = 0; t < 24000; t += 50) r.update(open, 50, 100, "domain");
    expect(r.stage).toBe("draw");
    draw(r, circle(), "domain");
    expect(r.stage).toBe("release");
  });
  it("expires unfinished rituals without spending energy", () => {
    const r = new Ritual();
    prime(r);
    hold(r, open, 18500);
    expect(r.stage).toBe("idle");
    expect(r.hint).toContain("рассеялся");
  });
});
it("awakening waits for the reveal, then requires a held sign followed by separated hands", () => {
  const a = new Awakening(),
    sign = input({ dualSign: true, twoHands: true, handGap: 0.18 });
  for (let t = 0; t < 4000; t += 50) a.update(sign, 50);
  expect(a.armed).toBe(false);
  for (let t = 0; t < 950; t += 50) a.update(sign, 50);
  expect(a.armed).toBe(true);
  expect(a.complete).toBe(false);
  a.update(input({ twoHands: true, handGap: 0.4 }), 50);
  expect(a.complete).toBe(true);
});
