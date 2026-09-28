import { describe, expect, it } from 'vitest';
import { describeHand, GestureLesson, type Hand, type Point } from './gestures';

const hand = (overrides: Partial<Hand> = {}): Hand => ({ cursor: { x: 0.5, y: 0.5 }, pinchRatio: 1.2, extended: 4, open: true, quality: null, ...overrides });

function openPoints(): Point[] {
  const points: Point[] = [{ x: 0.5, y: 0.8 }, { x: 0.4, y: 0.68 }, { x: 0.32, y: 0.6 }, { x: 0.26, y: 0.52 }, { x: 0.2, y: 0.43 }];
  for (const x of [0.35, 0.42, 0.5, 0.58]) for (const y of [0.52, 0.4, 0.3, 0.2]) points.push({ x, y });
  return points;
}

describe('hand geometry', () => {
  it('normalizes pinch distance to palm size', () => {
    const p = openPoints();
    const smaller = p.map(point => ({ x: 0.5 + (point.x - 0.5) * 0.6, y: 0.5 + (point.y - 0.5) * 0.6 }));
    expect(describeHand(p)?.open).toBe(true);
    expect(describeHand(smaller)?.pinchRatio).toBeCloseTo(describeHand(p)!.pinchRatio);
    expect(describeHand(smaller)?.open).toBe(true);
  });
  it('corrects aspect ratio before measuring geometry', () => {
    const p = openPoints();
    const widescreen = p.map(point => ({ x: point.x * 0.75, y: point.y }));
    expect(describeHand(widescreen, 16 / 9)?.pinchRatio).toBeCloseTo(describeHand(p, 4 / 3)!.pinchRatio);
  });
  it('identifies clipped and distant hands and rejects malformed input', () => {
    const clipped = openPoints(); clipped[8].x = 0.001;
    expect(describeHand(clipped)?.quality).toContain('целиком');
    expect(describeHand(openPoints().map(p => ({ x: 0.5 + p.x * 0.1, y: 0.5 + p.y * 0.1 })))?.quality).toContain('ближе');
    expect(describeHand([])).toBeNull();
    const malformed = openPoints(); malformed[0].x = NaN;
    expect(describeHand(malformed)).toBeNull();
  });
});

describe('gesture lessons', () => {
  it('requires a held pinch and delivery into the portal', () => {
    const lesson = new GestureLesson();
    const pinched = hand({ pinchRatio: 0.2, open: false, cursor: { x: 0.2, y: 0.2 } });
    for (let t = 100; t <= 400; t += 50) expect(lesson.update('pinch', pinched, t).success).toBe(false);
    expect(lesson.update('pinch', { ...pinched, cursor: { x: 0.5, y: 0.5 } }, 450).success).toBe(true);
    expect(lesson.update('pinch', pinched, 500).success).toBe(false);
  });
  it('keeps the pinch through small threshold jitter but releases a wide pinch', () => {
    const lesson = new GestureLesson();
    const outside = { x: 0.2, y: 0.3 };
    lesson.update('pinch', hand({ pinchRatio: 0.2, cursor: outside }), 100);
    expect(lesson.update('pinch', hand({ pinchRatio: 0.34, cursor: outside }), 150).holding).toBe(true);
    expect(lesson.update('pinch', hand({ pinchRatio: 0.5, cursor: outside }), 200).holding).toBe(false);
  });
  it('does not carry shield progress across tracking loss or a long frame gap', () => {
    const lesson = new GestureLesson();
    for (let t = 100; t <= 800; t += 50) lesson.update('shield', hand(), t);
    lesson.update('shield', null, 850);
    expect(lesson.update('shield', hand(), 900).progress).toBe(0);
    expect(lesson.update('shield', hand(), 4000).progress).toBe(0);
  });
  it('requires a steady open palm for the shield', () => {
    const lesson = new GestureLesson();
    lesson.update('shield', hand(), 100);
    expect(lesson.update('shield', hand({ cursor: { x: 0.7, y: 0.5 } }), 150).hint).toContain('месте');
    expect(lesson.update('shield', hand({ open: false, extended: 2 }), 200).progress).toBe(0);
    let success = false;
    for (let t = 250; t <= 1250; t += 50) success ||= lesson.update('shield', hand(), t).success;
    expect(success).toBe(true);
  });
  it('recognizes a horizontal sweep in either direction', () => {
    for (const direction of [1, -1]) {
      const lesson = new GestureLesson();
      let success = false;
      for (let i = 0; i <= 6; i++) success ||= lesson.update('swipe', hand({ cursor: { x: 0.5 + direction * (i * 0.05 - 0.15), y: 0.5 } }), 100 + i * 40).success;
      expect(success).toBe(true);
    }
  });
  it('rejects slow drift, diagonal movement, and jumps after tracking loss', () => {
    const slow = new GestureLesson();
    for (let i = 0; i < 20; i++) expect(slow.update('swipe', hand({ cursor: { x: 0.2 + i * 0.02, y: 0.5 } }), 100 + i * 100).success).toBe(false);
    const diagonal = new GestureLesson();
    diagonal.update('swipe', hand({ cursor: { x: 0.2, y: 0.2 } }), 100);
    expect(diagonal.update('swipe', hand({ cursor: { x: 0.6, y: 0.6 } }), 300).success).toBe(false);
    const interrupted = new GestureLesson();
    interrupted.update('swipe', hand({ cursor: { x: 0.2, y: 0.5 } }), 100);
    interrupted.update('swipe', null, 150);
    expect(interrupted.update('swipe', hand({ cursor: { x: 0.8, y: 0.5 } }), 200).success).toBe(false);
  });

  it('recognizes a sweep after stationary frames and a short preparatory movement', () => {
    const lesson = new GestureLesson();
    for (let t = 100; t <= 600; t += 50) lesson.update('swipe', hand({ cursor: { x: 0.635, y: 0.5 } }), t);
    let success = false;
    for (let i = 0; i <= 6; i++) success ||= lesson.update('swipe', hand({ cursor: { x: 0.485 + i * 0.05, y: 0.5 } }), 650 + i * 50).success;
    expect(success).toBe(true);
  });
});
