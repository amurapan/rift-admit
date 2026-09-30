export type Point = { x: number; y: number; z?: number };
export type Hand = {
  cursor: Point;
  palm?: Point;
  pinchRatio: number;
  extended: number;
  open: boolean;
  bladeSign?: boolean;
  spearSign?: boolean;
  quality: string | null;
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: Point, b: Point, c: Point) => {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (u.x * v.x + u.y * v.y) /
            Math.max(0.000001, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)),
        ),
      ),
    ) *
      180) /
    Math.PI
  );
};

export function describeHand(points: Point[], aspect = 4 / 3): Hand | null {
  if (
    points.length !== 21 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return null;
  const p = points.map((point) => ({ x: point.x * aspect, y: point.y }));
  const scale = distance(p[0], p[9]);
  const fingers = [5, 9, 13, 17].map(
    (i) =>
      angle(p[i], p[i + 1], p[i + 3]) > 150 &&
      distance(p[i + 3], p[0]) > distance(p[i + 1], p[0]) * 1.12,
  );
  const extended = fingers.filter(Boolean).length;
  const pinchRatio = distance(p[4], p[8]) / Math.max(scale, 0.001);
  const thumbOpen = distance(p[4], p[5]) / Math.max(scale, 0.001) > 0.42;
  const clipped = points.some(
    (point) =>
      point.x < 0.003 || point.x > 0.997 || point.y < 0.003 || point.y > 0.997,
  );
  return {
    palm: {
      x: 1 - (points[0].x + points[5].x + points[9].x + points[17].x) / 4,
      y: (points[0].y + points[5].y + points[9].y + points[17].y) / 4,
    },
    cursor: {
      x: 1 - (points[4].x + points[8].x) / 2,
      y: (points[4].y + points[8].y) / 2,
    },
    bladeSign: fingers[0] && fingers[1] && !fingers[2] && !fingers[3],
    spearSign:
      fingers[0] &&
      !fingers[1] &&
      !fingers[2] &&
      !fingers[3] &&
      thumbOpen &&
      pinchRatio > 0.5,
    pinchRatio,
    extended,
    open: extended === 4 && thumbOpen && pinchRatio > 0.5,
    quality: clipped
      ? "Верни кисть целиком в кадр"
      : scale < 0.065
        ? "Поднеси руку ближе к камере"
        : scale > 0.52
          ? "Отодвинь руку немного от камеры"
          : null,
  };
}

export type Lesson = "vortex" | "shield" | "swipe" | "domain";
