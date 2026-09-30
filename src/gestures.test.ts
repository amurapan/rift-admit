import { describe, expect, it } from "vitest";
import { describeHand, type Point } from "./gestures";

function openPoints(): Point[] {
  const points: Point[] = [
    { x: 0.5, y: 0.8 },
    { x: 0.4, y: 0.68 },
    { x: 0.32, y: 0.6 },
    { x: 0.26, y: 0.52 },
    { x: 0.2, y: 0.43 },
  ];
  for (const x of [0.35, 0.42, 0.5, 0.58])
    for (const y of [0.52, 0.4, 0.3, 0.2]) points.push({ x, y });
  return points;
}

describe("hand geometry", () => {
  it("normalizes pinch distance to palm size", () => {
    const p = openPoints();
    const smaller = p.map((point) => ({
      x: 0.5 + (point.x - 0.5) * 0.6,
      y: 0.5 + (point.y - 0.5) * 0.6,
    }));
    expect(describeHand(p)?.open).toBe(true);
    expect(describeHand(smaller)?.pinchRatio).toBeCloseTo(
      describeHand(p)!.pinchRatio,
    );
    expect(describeHand(smaller)?.open).toBe(true);
  });
  it("corrects aspect ratio before measuring geometry", () => {
    const p = openPoints();
    const widescreen = p.map((point) => ({ x: point.x * 0.75, y: point.y }));
    expect(describeHand(widescreen, 16 / 9)?.pinchRatio).toBeCloseTo(
      describeHand(p, 4 / 3)!.pinchRatio,
    );
  });
  it("identifies clipped and distant hands and rejects malformed input", () => {
    const nearEdge = openPoints();
    nearEdge[8].y = 0.01;
    expect(describeHand(nearEdge)?.quality).toBeNull();
    const clipped = openPoints();
    clipped[8].x = 0.001;
    expect(describeHand(clipped)?.quality).toContain("целиком");
    expect(
      describeHand(
        openPoints().map((p) => ({ x: 0.5 + p.x * 0.1, y: 0.5 + p.y * 0.1 })),
      )?.quality,
    ).toContain("ближе");
    expect(describeHand([])).toBeNull();
    const malformed = openPoints();
    malformed[0].x = NaN;
    expect(describeHand(malformed)).toBeNull();
  });
});

it("distinguishes the spear seal from the blade and a pinch using actual landmarks", () => {
  const p = openPoints();
  for (const i of [9, 13, 17]) p[i + 3] = { ...p[i], y: p[i].y + 0.04 };
  expect(describeHand(p)?.spearSign).toBe(true);
  expect(describeHand(p)?.bladeSign).toBe(false);
  p[4] = { x: p[8].x + 0.01, y: p[8].y };
  expect(describeHand(p)?.spearSign).toBe(false);
  const sign = openPoints();
  for (const i of [13, 17]) sign[i + 3] = { ...sign[i], y: sign[i].y + 0.04 };
  expect(describeHand(sign)?.bladeSign).toBe(true);
  expect(describeHand(sign)?.spearSign).toBe(false);
});
