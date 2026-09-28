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
