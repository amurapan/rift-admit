import { describe, expect, it } from "vitest";
import { Awakening, Ritual } from "./ritual";
import { emptyControl, type Control } from "./control";
const input = (o: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...o,
});
const open = input({ open: true });
function hold(r: Ritual, c: Control, ms: number, energy = 100) {
  let result = {};
  for (let t = 0; t < ms; t += 50) result = r.update(c, 50, energy);
  return result;
}
const sign = input({
  twoHands: true,
  bladeSign: true,
  secondSign: true,
  dualSign: true,
});
const palms = input({ twoHands: true, open: true, secondOpen: true });
function prime(r: Ritual) {
  hold(r, sign, 700);
}
describe("spell rituals", () => {
  it("tolerates brief recognition flicker without counting missing or incorrect poses as hold time", () => {
    const pose = sign;
    for (const missing of [
      emptyControl(),
      input({ twoHands: true, open: true, secondOpen: false }),
    ]) {
      const r = new Ritual();
      hold(r, pose, 600);
      hold(r, missing, 150);
      expect(r.domainHold).toBe(600);
      expect(r.stage).toBe("idle");
      r.update(pose, 50, 100);
      expect(r.stage).toBe("idle");
      r.update(pose, 50, 100);
      expect(r.stage).toBe("release");
    }
  });
  it("resets the initial hold after sustained tracking loss or an explicit pause", () => {
    const pose = sign;
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
  it("requires energy and two signed hands before a separate open-palm release", () => {
    const r = new Ritual();
    hold(r, sign, 1000, 90);
    expect(r.stage).toBe("idle");
    prime(r);
    expect(r.stage).toBe("release");
    expect(r.bladeMs).toBe(0);
    hold(r, open, 800);
    expect(r.stage).toBe("release");
    expect(r.hint).toContain("вторую руку");
    hold(r, palms, 300);
    expect(r.update(palms, 50, 100).domain).toBe(true);
    expect(r.update(palms, 50, 100).domain).toBeUndefined();
  });
  it("preserves an accepted seal on loss but requires a fresh complete release hold", () => {
    const r = new Ritual();
    prime(r);
    hold(r, palms, 200);
    r.update(emptyControl(), 50, 100);
    expect(r.stage).toBe("release");
    expect(r.releaseHold).toBe(0);
    expect(r.update(palms, 200, 100).domain).toBeUndefined();
    expect(r.update(palms, 150, 100).domain).toBe(true);
  });
  it("expires an unfinished battle seal but gives the lesson unlimited time", () => {
    const r = new Ritual();
    prime(r);
    hold(r, sign, 8100);
    expect(r.stage).toBe("idle");
    expect(r.hint).toContain("рассеялась");
    const lesson = new Ritual();
    prime(lesson);
    for (let t = 0; t < 24000; t += 50) lesson.update(sign, 50, 100, "domain");
    expect(lesson.stage).toBe("release");
  });
  it("casts each extra technique only after its unlock and a deliberate hold", () => {
    const r = new Ritual(),
      spear = input({ spearSign: true });
    for (let t = 0; t < 800; t += 50)
      expect(r.update(spear, 50, 0, null, 0).spear).toBeUndefined();
    for (let t = 0; t < 550; t += 50)
      expect(r.update(spear, 50, 0, null, 1).spear).toBeUndefined();
    expect(r.update(spear, 50, 0, null, 1).spear).toBeDefined();
    for (let t = 0; t < 5000; t += 50)
      expect(r.update(spear, 50, 0, null, 1).spear).toBeUndefined();
    r.update(open, 50, 0, null, 1);
    for (let t = 0; t < 550; t += 50) r.update(spear, 50, 0, null, 1);
    expect(r.update(spear, 50, 0, null, 1).spear).toBeDefined();
    const bind = input({
      bindPose: true,
      twoHands: true,
      open: true,
      secondFist: true,
    });
    r.update(bind, 50, 0, null, 2); // A different deliberate seal can follow the spear.
    expect(r.bindHold).toBe(50);
    r.update(open, 50, 0, null, 2);
    for (let t = 0; t < 600; t += 50) r.update(bind, 50, 0, null, 2);
    expect(r.update(bind, 50, 0, null, 2).bind).toBe(true);
    expect(r.bladeMs).toBe(0);
    expect(r.vortex).toBeNull();
  });
  it("does not complete a spear hold through tracking loss", () => {
    const r = new Ritual(),
      spear = input({ spearSign: true });
    for (let t = 0; t < 500; t += 50) r.update(spear, 50, 0, null, 1);
    r.update(emptyControl(), 50, 0, null, 1);
    expect(r.update(spear, 200, 0, null, 1).spear).toBeUndefined();
    expect(r.spearHold).toBe(0);
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

it("a spare open palm does not steal a normal blade at full territory energy", () => {
  const r = new Ritual();
  hold(
    r,
    input({ bladeSign: true, twoHands: true, secondOpen: true }),
    350,
    100,
  );
  expect(r.bladeMs).toBeGreaterThan(0);
  expect(r.stage).toBe("idle");
  expect(r.domainHold).toBe(0);
});
