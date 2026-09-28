import { expect, it } from "vitest";
import { HandOverlay, Pointer } from "./pointer";

it("continues short visual motion between samples without an unbounded extrapolation", () => {
  const p = new Pointer();
  p.sample({ x: 0.2, y: 0.5 }, 100);
  p.draw(100);
  p.sample({ x: 0.25, y: 0.5 }, 150);
  const received = p.draw(150);
  const between = p.draw(170);
  expect(between.x).toBeGreaterThan(received.x);
  expect(between.x).toBeGreaterThan(0.25);
  expect(p.draw(230).x).toBeLessThanOrEqual(0.28);
  expect(p.draw(500).x).toBeCloseTo(0.25, 4);
});
it("stationary samples and direction changes stop prediction immediately", () => {
  const p = new Pointer();
  p.sample({ x: 0.2, y: 0.5 }, 100);
  p.draw(100);
  p.sample({ x: 0.25, y: 0.5 }, 150);
  p.draw(175);
  p.sample({ x: 0.25, y: 0.5 }, 200);
  expect(Math.abs(p.draw(240).x - 0.25)).toBeLessThan(0.001);
  p.sample({ x: 0.21, y: 0.5 }, 250);
  expect(p.draw(275).x).toBeLessThan(0.21);
});
it("updates skeleton presentation between measurements and clears lost hands", () => {
  const overlay = new HandOverlay();
  const hands = [[{ x: 0.2, y: 0.5 }]];
  overlay.sample(hands, 100);
  overlay.draw(100);
  overlay.sample([[{ x: 0.25, y: 0.5 }]], 150);
  overlay.draw(150);
  expect(overlay.draw(170)[0][0].x).toBeGreaterThan(0.25);
  expect(hands[0][0].x).toBe(0.2);
  overlay.sample([], 200);
  expect(overlay.draw(210)).toEqual([]);
  overlay.sample(hands, 250);
  expect(overlay.draw(260)[0][0].x).toBe(0.2);
});
