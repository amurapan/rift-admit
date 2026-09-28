import { expect, it } from "vitest";
import { HandOverlay, Pointer } from "./pointer";

it("moves between measurements, bounds prediction and settles after input stops", () => {
  const p = new Pointer();
  p.sample({ x: 0.2, y: 0.5 }, 100);
  p.draw(100);
  p.sample({ x: 0.25, y: 0.5 }, 150);
  const received = p.draw(150);
  expect(p.draw(170).x).toBeGreaterThan(received.x);
  for (let t = 180; t <= 650; t += 10)
    expect(p.draw(t).x).toBeLessThanOrEqual(0.268);
  expect(Math.abs(p.draw(660).x - 0.25)).toBeLessThan(0.001);
});
it("attenuates stationary jitter across slow and fast detector rates", () => {
  for (const interval of [33, 67, 143]) {
    const p = new Pointer();
    p.sample({ x: 0.5, y: 0.5 }, 0);
    const positions: number[] = [];
    for (let t = 0, sample = interval, n = 0; t <= 2200; t += 8) {
      if (t >= sample) {
        p.sample({ x: 0.5 + (n++ % 2 ? 0.004 : -0.004), y: 0.5 }, t);
        sample += interval;
      }
      const x = p.draw(t).x;
      if (t > 500) positions.push(x);
    }
    // At least a quarter of the measured jitter is removed even at 7 Hz.
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.006);
  }
});
it("follows deliberate movement promptly and reverses without a teleport", () => {
  const p = new Pointer();
  p.sample({ x: 0.2, y: 0.5 }, 100);
  p.draw(100);
  p.sample({ x: 0.55, y: 0.5 }, 150);
  const first = p.draw(150).x;
  expect(first).toBeGreaterThan(0.2);
  expect(first).toBeLessThan(0.55);
  for (let t = 166; t <= 246; t += 16) p.draw(t);
  expect(Math.abs(p.draw(250).x - 0.55)).toBeLessThan(0.03);
  p.sample({ x: 0.4, y: 0.5 }, 260);
  for (let t = 266; t <= 346; t += 16) p.draw(t);
  expect(Math.abs(p.draw(350).x - 0.4)).toBeLessThan(0.03);
});
it("updates skeleton presentation between measurements and clears lost hands", () => {
  const overlay = new HandOverlay();
  const hands = [[{ x: 0.2, y: 0.5 }]];
  overlay.sample(hands, 100);
  overlay.draw(100);
  overlay.sample([[{ x: 0.25, y: 0.5 }]], 150);
  const before = overlay.draw(150)[0][0].x;
  expect(overlay.draw(170)[0][0].x).toBeGreaterThan(before);
  expect(hands[0][0].x).toBe(0.2);
  overlay.sample([], 200);
  expect(overlay.draw(210)).toEqual([]);
  overlay.sample(hands, 250);
  expect(overlay.draw(260)[0][0].x).toBe(0.2);
});
