export type Point = { x: number; y: number; z?: number };
export type Hand = {
  cursor: Point;
  pinchRatio: number;
  extended: number;
  open: boolean;
  quality: string | null;
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (a: Point, b: Point, c: Point) => {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  return Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / Math.max(0.000001, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))))) * 180 / Math.PI;
};

export function describeHand(points: Point[], aspect = 4 / 3): Hand | null {
  if (points.length !== 21 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const p = points.map(point => ({ x: point.x * aspect, y: point.y }));
  const scale = distance(p[0], p[9]);
  const extended = [5, 9, 13, 17].filter(i =>
    angle(p[i], p[i + 1], p[i + 3]) > 150 && distance(p[i + 3], p[0]) > distance(p[i + 1], p[0]) * 1.12,
  ).length;
  const pinchRatio = distance(p[4], p[8]) / Math.max(scale, 0.001);
  const thumbOpen = distance(p[4], p[5]) / Math.max(scale, 0.001) > 0.42;
  const clipped = points.some(point => point.x < 0.015 || point.x > 0.985 || point.y < 0.015 || point.y > 0.985);
  return {
    cursor: { x: 1 - (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2 },
    pinchRatio, extended,
    open: extended === 4 && thumbOpen && pinchRatio > 0.5,
    quality: clipped ? 'Верни кисть целиком в кадр' : scale < 0.065 ? 'Поднеси руку ближе к камере' : scale > 0.52 ? 'Отодвинь руку немного от камеры' : null,
  };
}

export type Lesson = 'pinch' | 'shield' | 'swipe';
export type Reading = { hint: string; progress: number; success: boolean; holding: boolean };
type Sample = { x: number; y: number; time: number };

export class GestureLesson {
  private previousTime = 0;
  private heldMs = 0;
  private pinched = false;
  private samples: Sample[] = [];
  private lastCursor: Point | null = null;
  private finished = false;

  reset() {
    this.previousTime = 0;
    this.heldMs = 0;
    this.pinched = false;
    this.samples = [];
    this.lastCursor = null;
    this.finished = false;
  }

  update(lesson: Lesson, hand: Hand | null, now: number): Reading {
    const gap = this.previousTime ? now - this.previousTime : 0;
    if (gap > 250 || gap < 0) this.reset();
    const dt = gap > 250 || gap < 0 ? 0 : Math.min(gap, 100);
    this.previousTime = now;
    if (!hand || hand.quality) {
      this.reset();
      return { hint: hand?.quality ?? 'Покажи одну руку целиком, ладонью к камере', progress: 0, success: false, holding: false };
    }
    if (this.finished) return { hint: 'Заклинание освоено', progress: 1, success: false, holding: false };
    const read = (hint: string, progress: number, success = false): Reading => {
      if (success) this.finished = true;
      return { hint, progress: Math.min(1, progress), success, holding: this.pinched };
    };

    if (lesson === 'pinch') {
      // Hysteresis prevents jitter around the pinch threshold.
      this.pinched = hand.pinchRatio < (this.pinched ? 0.42 : 0.28);
      this.heldMs = this.pinched ? this.heldMs + dt : 0;
      if (!this.pinched) return read('Сведи большой и указательный пальцы — появится искра', Math.max(0, 1 - hand.pinchRatio) * 0.25);
      if (this.heldMs < 180) return read('Удерживай пальцы вместе', this.heldMs / 180 * 0.4);
      const toPortal = distance(hand.cursor, { x: 0.5, y: 0.5 });
      return read(toPortal < 0.13 ? 'Энергия доставлена в разлом' : 'Не размыкая пальцы, перенеси искру в центр разлома', 0.4 + Math.max(0, 1 - toPortal / 0.6) * 0.6, toPortal < 0.13);
    }

    if (lesson === 'shield') {
      const speed = this.lastCursor && dt > 0 ? distance(this.lastCursor, hand.cursor) / (dt / 1000) : 0;
      this.lastCursor = hand.cursor;
      if (!hand.open) {
        this.heldMs = 0;
        return read(hand.extended < 4 ? 'Выпрями четыре пальца и раскрой ладонь' : 'Отведи большой палец в сторону', 0);
      }
      if (speed > 0.85) {
        this.heldMs = 0;
        return read('Задержи раскрытую ладонь на месте, чтобы собрать щит', 0);
      }
      this.heldMs += dt;
      return read(this.heldMs >= 850 ? 'Щит выдержал удар' : 'Держи ладонь раскрытой и неподвижной', this.heldMs / 850, this.heldMs >= 850);
    }

    if (!hand.open) {
      this.samples = [];
      return read('Раскрой ладонь перед взмахом', 0);
    }
    this.samples.push({ ...hand.cursor, time: now });
    this.samples = this.samples.filter(sample => now - sample.time <= 450);
    // A sweep can start anywhere inside the window. Using only its oldest frame
    // dilutes fast movement with the stationary frames immediately before it.
    const candidates = this.samples.map(sample => ({
      travel: Math.abs(hand.cursor.x - sample.x),
      elapsed: (now - sample.time) / 1000,
      vertical: Math.abs(hand.cursor.y - sample.y),
    }));
    const success = candidates.some(sample => sample.elapsed >= 0.1 && sample.travel >= 0.24 && sample.travel / sample.elapsed >= 0.65 && sample.vertical < 0.18);
    if (success) return read('Кристалл разрушен', 1, true);
    const { travel, vertical } = candidates.reduce((best, candidate) => candidate.travel > best.travel ? candidate : best);
    if (vertical >= 0.18) return read('Проведи ладонью горизонтально, слева направо или обратно', travel / 0.24);
    return read(travel > 0.07 ? 'Взмахни шире и быстрее — примерно на треть кадра' : 'Резко проведи открытой ладонью в сторону', travel / 0.24);
  }
}
