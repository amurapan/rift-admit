import type { Lesson, Point } from "../gestures";
import { clamp, distance, type Control, type Slash } from "./control";
import { Ritual } from "./ritual";
export const CORE = { x: 0.5, y: 0.9 },
  BOSS = { x: 0.5, y: 0.2 },
  ROUND_MS = 150000;
export type Entity = Point & {
  id: number;
  kind: "orb" | "crystal" | "armored";
  team: "enemy" | "friendly";
  vx: number;
  vy: number;
  r: number;
  hp: number;
  age: number;
  telegraph: number;
};
export type FX = {
  type:
    | "charge"
    | "armed"
    | "seal"
    | "fail"
    | "burst"
    | "block"
    | "parry"
    | "slash"
    | "break"
    | "hurt"
    | "boss"
    | "phase"
    | "domain"
    | "victory"
    | "defeat";
  position: Point;
  to?: Point;
  text?: string;
  power?: number;
  continuation?: boolean;
};
export type Stats = {
  bursts: number;
  burstHits: number;
  blocks: number;
  parries: number;
  cuts: number;
  cutHits: number;
  damage: number;
  domains: number;
  offTargetCuts: number;
  failedRituals: number;
};
export type Advice = { lesson: Lesson; title: string; detail: string };
export const freshStats = (): Stats => ({
  bursts: 0,
  burstHits: 0,
  blocks: 0,
  parries: 0,
  cuts: 0,
  cutHits: 0,
  damage: 0,
  domains: 0,
  offTargetCuts: 0,
  failedRituals: 0,
});
export function advice(s: Stats): Advice {
  if (s.failedRituals > 0)
    return {
      lesson: "domain",
      title: "Замкни печать",
      detail:
        "Рисуй один крупный круг щипком. Соедини конец с началом, отпусти пальцы, затем разведи открытые ладони.",
    };
  if (s.offTargetCuts > s.cutHits)
    return {
      lesson: "swipe",
      title: "Точность разреза",
      detail: `Попадания: ${s.cutHits} из ${s.cuts}. Удержи два пальца, затем проведи линию прямо через кристалл.`,
    };
  if (s.damage > 0)
    return {
      lesson: "shield",
      title: "Позиция отражения",
      detail: `Пропущено атак: ${s.damage}. Поставь открытую ладонь на светящуюся траекторию до попадания в ядро.`,
    };
  return {
    lesson: "vortex",
    title: "Сжатие пространства",
    detail: `Волны с попаданием: ${s.burstHits} из ${s.bursts}. Собирай врагов в воронку кулаком, затем полностью раскрой ладонь.`,
  };
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = (b.y - a.y) * 0.7;
  const t = clamp(
    ((p.x - a.x) * dx + (p.y - a.y) * 0.7 * dy) /
      Math.max(1e-8, dx * dx + dy * dy),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + (t * dy) / 0.7 });
}
export class Arena {
  status: "countdown" | "fighting" | "victory" | "defeat" = "countdown";
  countdownMs = 3000;
  elapsed = 0;
  phase = 0;
  health = 100;
  bossHp = 240;
  shieldEnergy = 100;
  energy = 0;
  domainMs = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;
  entities: Entity[] = [];
  stats = freshStats();
  events: FX[] = [];
  hint = "Кулак — сжатие. Два пальца — разрез. Ладонь — отражение.";
  hintUntil = 0;
  practiceDone = false;
  shieldActive = false;
  shieldAge = 0;
  paused = true;
  magic = new Ritual();
  waves: {
    position: Point;
    radius: number;
    max: number;
    power: number;
    hit: Set<number>;
    counted: boolean;
  }[] = [];
  private cuts: { slash: Slash; remaining: number }[] = [];
  private lastStroke: number | undefined;
  private spawnMs = 700;
  private nextId = 1;
  private randomState = 51928;
  private overheated = false;
  private lastHit = 0;
  private lastGesture: Lesson | null = null;
  private lastBossCycle = -1;
  constructor(public practice: Lesson | null = null) {
    if (practice) {
      this.status = "fighting";
      this.spawnMs = 0;
      if (practice === "domain") this.energy = 100;
    }
  }
  get remainingMs() {
    return Math.max(0, ROUND_MS - this.elapsed);
  }
  get ended() {
    return this.status === "victory" || this.status === "defeat";
  }
  get exposed() {
    return (
      this.domainMs > 0 ||
      (this.phase === 2 && (this.elapsed - 65000) % 9000 > 4200)
    );
  }
  private random() {
    this.randomState =
      (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }
  private effect(type: FX["type"], position: Point, text?: string, to?: Point) {
    this.events.push({ type, position: { ...position }, text, to });
  }
  private coach(message: string) {
    this.hint = message;
    this.hintUntil = this.elapsed + 2700;
  }
  spawn(
    kind: Entity["kind"],
    position: Point,
    velocity?: Point,
    telegraph = 800,
  ): Entity {
    const speed = kind === "orb" ? 0.12 + this.phase * 0.025 : 0.06,
      d = Math.max(0.01, distance(position, CORE));
    const e: Entity = {
      ...position,
      id: this.nextId++,
      kind,
      team: "enemy",
      vx: velocity?.x ?? ((CORE.x - position.x) / d) * speed,
      vy: velocity?.y ?? ((CORE.y - position.y) / d) * speed,
      r: kind === "orb" ? 0.023 : 0.04,
      hp: kind === "armored" ? 2 : 1,
      age: 0,
      telegraph,
    };
    this.entities.push(e);
    return e;
  }
  private spawnWave() {
    if (this.practice) {
      if (this.entities.length || this.practiceDone) return;
      if (this.practice === "vortex")
        for (const x of [0.3, 0.5, 0.7])
          this.spawn("crystal", { x, y: 0.5 }, { x: 0, y: 0 }, 0);
      if (this.practice === "shield")
        this.spawn("orb", { x: 0.72, y: 0.3 }, undefined, 1300);
      if (this.practice === "swipe")
        this.spawn("crystal", { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 0);
      if (this.practice === "domain")
        for (const x of [0.25, 0.75])
          this.spawn("armored", { x, y: 0.4 }, { x: 0, y: 0 }, 0);
      return;
    }
    if (this.entities.length >= 16) return;
    const x = 0.14 + this.random() * 0.72;
    const kind =
      this.random() > 0.6
        ? this.phase > 0 && this.random() > 0.55
          ? "armored"
          : "crystal"
        : "orb";
    this.spawn(kind, { x, y: 0.14 + this.random() * 0.1 });
    if (this.phase > 0 && this.random() > 0.62)
      this.spawn("orb", { x: 1 - x, y: 0.3 });
  }
  tick(deltaMs: number, input: Control) {
    if (
      this.ended ||
      this.practiceDone ||
      !Number.isFinite(deltaMs) ||
      deltaMs <= 0
    )
      return;
    this.paused = !input.valid;
    if (!input.valid) {
      this.shieldActive = false;
      this.shieldAge = 0;
      this.magic.pause(deltaMs);
      return;
    }
    let dt = deltaMs;
    if (this.status === "countdown") {
      const used = Math.min(this.countdownMs, dt);
      this.countdownMs -= used;
      dt -= used;
      if (this.countdownMs > 0) return;
      this.status = "fighting";
      this.effect("phase", BOSS, "I · ПЕРВЫЕ ТРЕЩИНЫ");
    }
    const action = this.magic.update(
      input,
      dt,
      this.domainMs ? 0 : this.energy,
      this.practice,
    );
    if (action.cue) {
      this.effect(action.cue, input.position);
      if (action.cue === "fail" && this.magic.circle)
        this.stats.failedRituals++;
    }
    if (action.burst) {
      this.stats.bursts++;
      this.events.push({
        type: "burst",
        position: action.burst.position,
        power: action.burst.power,
      });
      this.waves.push({
        position: action.burst.position,
        radius: 0,
        max: 0.3 + action.burst.power * 0.35,
        power: action.burst.power,
        hit: new Set(),
        counted: false,
      });
    }
    if (action.slash) {
      const continuation =
        action.slash.id !== undefined && action.slash.id === this.lastStroke;
      if (!continuation) {
        this.stats.cuts++;
        this.cuts.push({ slash: { ...action.slash }, remaining: 260 });
        this.lastStroke = action.slash.id;
      } else {
        const pending = this.cuts.find((c) => c.slash.id === action.slash!.id);
        if (pending) pending.slash.to = action.slash.to;
      }
      this.events.push({
        type: "slash",
        position: action.slash.from,
        to: action.slash.to,
        continuation,
      });
    }
    if (action.domain) {
      this.energy = 0;
      this.domainMs = 7500;
      this.stats.domains++;
      for (const e of [...this.entities])
        if (e.team === "enemy") this.destroy(e, "domain");
      if (this.phase === 2) this.bossDamage(40);
      this.effect("domain", BOSS, "РАСШИРЕНИЕ ТЕРРИТОРИИ");
      if (this.practice === "domain") this.practiceDone = true;
    }
    while (dt > 0 && !this.ended && !this.practiceDone) {
      const step = Math.min(dt, 1000 / 60);
      this.step(step, input);
      dt -= step;
    }
    if (this.magic.hint) this.hint = this.magic.hint;
  }
  private step(ms: number, input: Control) {
    const dt = ms / 1000;
    this.elapsed += ms;
    if (!this.practice && this.remainingMs <= 0) {
      this.finish(false);
      return;
    }
    const phase = this.elapsed >= 65000 ? 2 : this.elapsed >= 30000 ? 1 : 0;
    if (!this.practice && phase !== this.phase) {
      this.phase = phase;
      this.effect(
        "phase",
        BOSS,
        phase === 1 ? "II · ВТОРЖЕНИЕ" : "III · ПРОБУЖДЕНИЕ",
      );
      this.coach(
        phase === 1
          ? "Броня выдержит один разрез. Заряди волну или атакуй дважды."
          : "После залпа глаз открывается — рассеки его!",
      );
    }
    if (this.combo && this.elapsed - this.lastHit > 6500) this.combo = 0;
    this.domainMs = Math.max(0, this.domainMs - ms);
    for (const cut of this.cuts) cut.remaining -= ms;
    for (const cut of this.cuts.filter((c) => c.remaining <= 0))
      this.resolveCut(cut.slash);
    this.cuts = this.cuts.filter((c) => c.remaining > 0);
    if (!this.practice && this.phase === 2) {
      const cycle = Math.floor((this.elapsed - 65000) / 9000);
      if ((this.elapsed - 65000) % 9000 >= 3000 && cycle > this.lastBossCycle) {
        this.lastBossCycle = cycle;
        for (const x of [0.38, 0.5, 0.62])
          this.spawn("orb", { x, y: 0.28 }, undefined, 1400);
        this.coach(
          "Залп! Подними печать отражения. Затем атакуй открытый глаз.",
        );
      }
    }
    if (this.overheated && this.shieldEnergy >= 30) this.overheated = false;
    const shielding =
      input.shield &&
      !this.magic.domainHold &&
      !this.magic.vortex &&
      !this.magic.bladeMs &&
      this.magic.stage === "idle" &&
      !this.overheated &&
      (!this.practice || this.practice === "shield");
    this.shieldAge = shielding ? this.shieldAge + ms : 0;
    this.shieldActive = shielding;
    this.shieldEnergy = clamp(
      this.shieldEnergy + (shielding ? -16 : input.shield ? 0 : 24) * dt,
      0,
      100,
    );
    if (this.shieldEnergy <= 0) {
      this.overheated = true;
      this.shieldActive = false;
      this.coach(
        "Печать истощена. Опусти ладонь или сожми руку для восстановления.",
      );
    }
    this.spawnMs -= ms * (this.domainMs ? 0.3 : 1);
    if (this.spawnMs <= 0) {
      this.spawnWave();
      this.spawnMs = this.practice ? 800 : [2300, 1800, 1400][this.phase];
    }
    for (const wave of this.waves) {
      wave.radius += dt * 0.95;
      for (const e of [...this.entities])
        if (
          e.team === "enemy" &&
          !wave.hit.has(e.id) &&
          distance(e, wave.position) < wave.radius + e.r
        ) {
          wave.hit.add(e.id);
          e.hp -= wave.power > 0.7 ? 2 : 1;
          if (!wave.counted) {
            this.stats.burstHits++;
            wave.counted = true;
          }
          if (e.hp <= 0) {
            this.destroy(e, "vortex");
            if (this.practice === "vortex") this.practiceDone = true;
          } else {
            const d = Math.max(0.01, distance(e, wave.position));
            e.vx = ((e.x - wave.position.x) / d) * 0.13;
            e.vy = -0.18;
            this.effect("break", e, "БРОНЯ ТРЕСНУЛА");
          }
        }
      if (
        this.phase === 2 &&
        !wave.hit.has(-1) &&
        distance(BOSS, wave.position) < wave.radius + 0.08
      ) {
        wave.hit.add(-1);
        this.bossDamage(this.exposed ? 28 : 12);
        this.reward("vortex", 120);
      }
    }
    this.waves = this.waves.filter((w) => w.radius < w.max);
    for (const e of [...this.entities]) {
      if (!this.entities.includes(e)) continue;
      e.age += ms;
      if (e.telegraph > 0) {
        e.telegraph -= ms;
        continue;
      }
      const before = { x: e.x, y: e.y };
      const vortex = this.magic.vortex;
      const trapped = e.team === "enemy" && vortex && distance(e, vortex) < 0.4;
      if (trapped) {
        const d = Math.max(0.035, distance(e, vortex));
        e.x += (vortex.x - e.x) * dt * 2.4;
        e.y += (vortex.y - e.y) * dt * 2.4;
        e.x += -(e.y - vortex.y) * dt * 0.7;
        e.y += (e.x - vortex.x) * dt * 0.7;
        if (d < 0.06) e.age = Math.min(e.age, 7000);
      } else {
        const slow = this.domainMs && e.team === "enemy" ? 0.18 : 1;
        e.x += e.vx * dt * slow;
        e.y += e.vy * dt * slow;
      }
      if (e.team === "friendly") {
        if (segmentDistance(BOSS, before, e) < 0.1 + e.r) {
          this.reward("shield", 150);
          if (this.phase === 2) this.bossDamage(26);
          this.remove(e);
          this.effect("boss", BOSS, "ВОЗВРАТ");
          continue;
        }
      } else {
        if (
          this.shieldActive &&
          segmentDistance(input.position, before, e) < 0.11 + e.r
        ) {
          if (e.kind === "orb" && (this.shieldAge < 650 || this.domainMs)) {
            e.team = "friendly";
            const d = distance(e, BOSS);
            e.vx = ((BOSS.x - e.x) / d) * 0.8;
            e.vy = ((BOSS.y - e.y) / d) * 0.8;
            this.stats.parries++;
            this.effect("parry", e, "ОТРАЖЕНО");
            this.reward("shield", 120);
          } else {
            this.remove(e);
            this.stats.blocks++;
            this.shieldEnergy = Math.max(
              0,
              this.shieldEnergy - (e.kind === "orb" ? 0 : 25),
            );
            this.effect("block", e);
            this.reward("shield", 65);
          }
          if (this.practice === "shield") this.practiceDone = true;
          continue;
        }
        if (
          !trapped &&
          (segmentDistance(CORE, before, e) < 0.065 + e.r || e.y > 0.98)
        ) {
          this.remove(e);
          if (!this.practice) {
            this.health = Math.max(
              0,
              this.health - (e.kind === "armored" ? 14 : 8),
            );
            this.stats.damage++;
            this.combo = 0;
            this.effect("hurt", CORE);
          }
          this.coach(
            "Перекрой траекторию раскрытой ладонью до попадания в ядро.",
          );
          if (this.health <= 0) this.finish(false);
          continue;
        }
      }
      if (e.x < -0.2 || e.x > 1.2 || e.y < -0.25 || e.age > 16000)
        this.remove(e);
    }
    if (this.elapsed > this.hintUntil)
      this.hint =
        this.energy >= 100
          ? "Территория готова: сблизь открытые ладони, затем нарисуй круг щипком."
          : this.phase === 2
            ? this.exposed
              ? "Глаз открыт — проведи разрез через него!"
              : "Подготовь сжатие или отрази залп. После атаки глаз откроется."
            : "Кулак → ладонь: волна. Два пальца → взмах: разрез. Ладонь: отражение.";
  }
  private resolveCut(slash: Slash) {
    let hits = 0;
    for (const e of [...this.entities])
      if (
        e.team === "enemy" &&
        segmentDistance(e, slash.from, slash.to) < e.r + 0.025
      ) {
        e.hp -= this.domainMs ? 2 : 1;
        hits++;
        if (e.hp <= 0) {
          this.destroy(e, "swipe");
          if (this.practice === "swipe") this.practiceDone = true;
        } else {
          this.effect("break", e, "БРОНЯ ТРЕСНУЛА");
          this.coach(
            "Сложи печать двух пальцев ещё раз и нанеси второй разрез.",
          );
        }
      }
    if (this.exposed && segmentDistance(BOSS, slash.from, slash.to) < 0.11) {
      this.bossDamage(this.domainMs ? 26 : 16);
      this.reward("swipe", 90);
      hits++;
    }
    if (hits) this.stats.cutHits++;
    else {
      this.stats.offTargetCuts++;
      this.coach("Разрез прошёл мимо. Направь светящуюся линию через цель.");
    }
    this.effect(
      "break",
      slash.to,
      hits > 1 ? `РАЗЛОМ ×${hits}` : undefined,
      slash.from,
    );
  }
  private reward(gesture: Lesson, base: number) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.lastHit = this.elapsed;
    const varied = this.lastGesture !== null && this.lastGesture !== gesture;
    this.score += base + Math.min(8, this.combo) * 10 + (varied ? 25 : 0);
    this.energy = Math.min(100, this.energy + (varied ? 16 : 10));
    this.lastGesture = gesture;
  }
  private destroy(e: Entity, gesture: Lesson) {
    this.remove(e);
    this.reward(gesture, e.kind === "armored" ? 150 : 90);
    this.effect("break", e);
  }
  private remove(e: Entity) {
    this.entities = this.entities.filter((o) => o.id !== e.id);
  }
  private bossDamage(amount: number) {
    if (!this.practice) this.bossHp = Math.max(0, this.bossHp - amount);
    this.effect("boss", BOSS);
    if (!this.practice && this.bossHp <= 0) this.finish(true);
  }
  private finish(won: boolean) {
    if (this.ended) return;
    this.status = won ? "victory" : "defeat";
    if (won)
      this.score += Math.ceil(this.remainingMs / 1000) * 5 + this.health * 5;
    this.magic.reset();
    this.effect(won ? "victory" : "defeat", BOSS);
  }
}
