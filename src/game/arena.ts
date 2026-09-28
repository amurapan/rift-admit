import type { Lesson, Point } from "../gestures";
import { clamp, distance, length, type Control, type Slash } from "./control";

export const CORE = { x: 0.5, y: 0.88 };
export const BOSS = { x: 0.5, y: 0.22 };
export const ROUND_MS = 150000;
export type Entity = Point & {
  id: number;
  kind: "orb" | "crystal" | "armored";
  team: "enemy" | "friendly" | "held";
  vx: number;
  vy: number;
  r: number;
  hp: number;
  age: number;
  telegraph: number;
  charged: boolean;
  source?: "throw" | "parry";
};
export type FX = {
  type:
    | "catch"
    | "throw"
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
  continuation?: boolean;
};
export type Stats = {
  catches: number;
  throws: number;
  returns: number;
  blocks: number;
  parries: number;
  cuts: number;
  cutHits: number;
  multikills: number;
  damage: number;
  domains: number;
  weakThrows: number;
  offTargetCuts: number;
  unstablePinches: number;
};
export type Advice = { lesson: Lesson; title: string; detail: string };
export const freshStats = (): Stats => ({
  catches: 0,
  throws: 0,
  returns: 0,
  blocks: 0,
  parries: 0,
  cuts: 0,
  cutHits: 0,
  multikills: 0,
  damage: 0,
  domains: 0,
  weakThrows: 0,
  offTargetCuts: 0,
  unstablePinches: 0,
});

export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = (b.y - a.y) * 0.7;
  const t = clamp(
    ((p.x - a.x) * dx + (p.y - a.y) * 0.7 * dy) /
      Math.max(1e-8, dx * dx + dy * dy),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + (t * dy) / 0.7 });
}

export function advice(stats: Stats): Advice {
  if (
    stats.weakThrows > 0 ||
    stats.unstablePinches > 0 ||
    (stats.throws > 0 && stats.returns / stats.throws < 0.5)
  )
    return {
      lesson: "pinch",
      title: "Прицельный бросок",
      detail: `Возвраты в цель: ${stats.returns} из ${stats.throws}. Веди захваченный снаряд к врагу и разомкни пальцы, пока рука ещё движется.`,
    };
  if (stats.offTargetCuts > stats.cutHits || stats.cuts === 0)
    return {
      lesson: "swipe",
      title: "Точность разреза",
      detail: `Разрезы с попаданием: ${stats.cutHits} из ${stats.cuts}. Светящаяся линия должна пересечь кристалл — взмах в стороне не нанесёт урон.`,
    };
  if (stats.damage > 0 || stats.blocks + stats.parries === 0)
    return {
      lesson: "shield",
      title: "Позиция щита",
      detail: `Ядро пропустило атак: ${stats.damage}. Ставь раскрытую ладонь на пунктирную траекторию перед снарядом.`,
    };
  return {
    lesson: "shield",
    title: "Идеальное отражение",
    detail: `Идеальных отражений: ${stats.parries}. Раскрой ладонь перед самым попаданием, чтобы отправить атаку обратно.`,
  };
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
  domainHold = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;
  entities: Entity[] = [];
  stats = freshStats();
  events: FX[] = [];
  hint = "Лови синие снаряды, отражай атаки и рассекай кристаллы";
  hintUntil = 0;
  practiceDone = false;
  shieldActive = false;
  shieldAge = 0;
  heldId: number | null = null;
  heldMs = 0;
  paused = true;
  private heldRearm = false;
  private overheated = false;
  private spawnMs = 500;
  private nextId = 1;
  private randomState = 51928;
  private lastHit = 0;
  private lastGesture: Lesson | null = null;
  private lastBossCycle = -1;
  private strokeId: number | undefined;
  private strokeHits = new Set<number>();
  private strokeMissAt = 0;
  private strokeCounted = false;
  private multiCounted = false;
  constructor(public practice: Lesson | null = null) {
    if (practice) {
      this.status = "fighting";
      this.spawnMs = 0;
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
      this.phase === 2 &&
      (this.domainMs > 0 || (this.elapsed - 65000) % 9000 > 4200)
    );
  }
  get held() {
    return this.entities.find((e) => e.id === this.heldId);
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
  private coach(text: string) {
    this.hint = text;
    this.hintUntil = this.elapsed + 2600;
  }

  spawn(
    kind: Entity["kind"],
    position: Point,
    velocity?: Point,
    telegraph = 650,
  ): Entity {
    const speed = kind === "orb" ? 0.15 + this.phase * 0.025 : 0.065;
    const d = Math.max(0.01, distance(position, CORE));
    const entity: Entity = {
      ...position,
      id: this.nextId++,
      kind,
      team: "enemy",
      vx: velocity?.x ?? ((CORE.x - position.x) / d) * speed,
      vy: velocity?.y ?? ((CORE.y - position.y) / d) * speed,
      r: kind === "orb" ? 0.022 : 0.04,
      hp: kind === "armored" ? 2 : 1,
      age: 0,
      telegraph,
      charged: false,
    };
    this.entities.push(entity);
    return entity;
  }

  private spawnWave() {
    if (this.practice) {
      if (this.entities.length || this.practiceDone) return;
      if (this.practice === "pinch")
        this.spawn("orb", { x: 0.3, y: 0.55 }, { x: 0, y: 0 }, 0);
      if (this.practice === "shield")
        this.spawn("orb", { x: 0.72, y: 0.3 }, undefined, 1300);
      if (this.practice === "swipe")
        this.spawn("crystal", { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 0);
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
    this.spawn(kind, { x, y: 0.13 + this.random() * 0.1 });
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
      this.domainHold = 0;
      this.heldRearm = this.heldId !== null;
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
    if (!this.practice || this.practice === "swipe")
      if (input.slash) this.slash(input.slash);
    if (
      (!this.practice || this.practice === "pinch") &&
      input.released &&
      this.held &&
      !this.heldRearm
    )
      this.release(input.velocity);
    while (dt > 0 && !this.ended && !this.practiceDone) {
      const slice = Math.min(dt, 1000 / 60);
      this.step(slice, input);
      dt -= slice;
    }
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
          ? "Броню кристаллов разбивает заряженный бросок или два разреза"
          : "Глаз открывается после залпа. Атакуй его в этот момент!",
      );
    }
    if (this.combo && this.elapsed - this.lastHit > 5500) this.combo = 0;
    this.domainMs = Math.max(0, this.domainMs - ms);
    if (this.strokeMissAt && this.elapsed >= this.strokeMissAt) {
      if (!this.strokeHits.size) {
        this.stats.offTargetCuts++;
        this.coach(
          "Разрез прошёл мимо. Проведи светящуюся линию прямо через кристалл.",
        );
      }
      this.strokeMissAt = 0;
    }
    if (!this.practice && this.phase === 2) {
      const cycle = Math.floor((this.elapsed - 65000) / 9000);
      if ((this.elapsed - 65000) % 9000 >= 3000 && cycle > this.lastBossCycle) {
        this.lastBossCycle = cycle;
        for (const x of [0.38, 0.5, 0.62])
          this.spawn("orb", { x, y: 0.28 }, undefined, 1100);
        this.coach(
          "Залп! Перехвати снаряд или поставь щит. После атаки глаз откроется.",
        );
      }
    }
    this.domainHold =
      !this.practice && this.energy >= 100 && input.domainPose && !this.domainMs
        ? this.domainHold + ms
        : 0;
    if (this.domainHold >= 1000) {
      this.energy = 0;
      this.domainHold = 0;
      this.domainMs = 6500;
      this.stats.domains++;
      for (const e of [...this.entities])
        if (e.team === "enemy") this.destroy(e, "swipe");
      if (this.phase === 2) this.bossDamage(40);
      this.effect("domain", BOSS, "РАСШИРЕНИЕ ТЕРРИТОРИИ");
      if (this.ended) return;
    }
    if (this.overheated && this.shieldEnergy >= 30) this.overheated = false;
    const shielding =
      input.shield &&
      !input.pinching &&
      this.heldId === null &&
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
      this.coach("Щит истощён. Сожми руку, чтобы восстановить защиту.");
    }
    if ((!this.practice || this.practice === "pinch") && input.pinching) {
      this.heldRearm = false;
      if (!this.held) {
        const target = this.entities.find(
          (e) =>
            e.kind === "orb" &&
            e.team === "enemy" &&
            e.telegraph <= 0 &&
            distance(e, input.position) < 0.085,
        );
        if (target) {
          target.team = "held";
          this.heldId = target.id;
          this.heldMs = 0;
          this.stats.catches++;
          this.effect("catch", target);
        }
      }
    }
    if (this.held && !this.heldRearm) {
      this.held.x = input.position.x;
      this.held.y = input.position.y;
      this.heldMs += ms;
      this.held.charged = this.heldMs > 650;
      if (this.heldMs > 3300)
        this.coach(
          "Снаряд перегревается — взмахни в сторону врага и разожми пальцы",
        );
      if (this.heldMs > 4800) {
        const e = this.held;
        this.remove(e);
        this.heldId = null;
        this.stats.unstablePinches++;
        this.effect("break", e, "Энергия рассеялась");
        this.coach("Не держи снаряд дольше четырёх секунд: взмахни и отпусти");
      }
    }
    this.spawnMs -= ms * (this.domainMs ? 0.3 : 1);
    if (this.spawnMs <= 0) {
      this.spawnWave();
      this.spawnMs = this.practice ? 800 : [2100, 1650, 1250][this.phase];
    }
    for (const entity of [...this.entities]) {
      if (!this.entities.includes(entity)) continue;
      entity.age += ms;
      if (entity.team === "held") continue;
      if (entity.telegraph > 0) {
        entity.telegraph -= ms;
        continue;
      }
      const before = { x: entity.x, y: entity.y };
      const slow = this.domainMs > 0 && entity.team === "enemy" ? 0.22 : 1;
      entity.x += entity.vx * dt * slow;
      entity.y += entity.vy * dt * slow;
      if (entity.team === "friendly") {
        const target = this.entities.find(
          (other) =>
            other.id !== entity.id &&
            other.team === "enemy" &&
            segmentDistance(other, before, entity) < other.r + entity.r,
        );
        if (target) {
          if (entity.source === "throw") this.stats.returns++;
          target.hp -= entity.charged ? 2 : 1;
          if (target.hp <= 0)
            this.destroy(
              target,
              entity.source === "parry" ? "shield" : "pinch",
            );
          else {
            this.effect("break", target, "БРОНЯ СНЯТА");
            this.coach(
              "Для пробития брони подержи снаряд щипком до заполнения кольца",
            );
          }
          this.remove(entity);
          if (this.practice === "pinch") this.practiceDone = true;
          continue;
        }
        if (segmentDistance(BOSS, before, entity) < 0.1 + entity.r) {
          if (entity.source === "throw") this.stats.returns++;
          this.reward(entity.source === "parry" ? "shield" : "pinch", 150);
          this.effect(
            "boss",
            BOSS,
            entity.charged ? "ЗАРЯЖЕННЫЙ БРОСОК" : "ВОЗВРАТ",
          );
          this.remove(entity);
          if (this.phase === 2 || this.practice)
            this.bossDamage(entity.charged ? 32 : 20);
          if (this.practice === "pinch") this.practiceDone = true;
          continue;
        }
      } else {
        if (
          this.shieldActive &&
          segmentDistance(input.position, before, entity) < 0.1 + entity.r
        ) {
          if (entity.kind !== "orb") {
            this.shieldEnergy = Math.max(0, this.shieldEnergy - 30);
            this.remove(entity);
            this.effect("block", entity, "ТЯЖЁЛЫЙ УДАР");
            this.stats.blocks++;
            this.reward("shield", 45);
          } else if (this.shieldAge < 600 || this.domainMs) {
            entity.team = "friendly";
            entity.source = "parry";
            this.aim(entity, BOSS, 0.8);
            this.stats.parries++;
            this.effect("parry", entity, "ИДЕАЛЬНО");
            this.reward("shield", 120);
          } else {
            this.remove(entity);
            this.stats.blocks++;
            this.effect("block", entity, "БЛОК");
            this.reward("shield", 65);
          }
          if (this.practice === "shield") this.practiceDone = true;
          continue;
        }
        if (
          segmentDistance(CORE, before, entity) < 0.075 + entity.r ||
          entity.y > 0.97
        ) {
          this.remove(entity);
          if (!this.practice) {
            this.health = Math.max(
              0,
              this.health - (entity.kind === "armored" ? 14 : 8),
            );
            this.stats.damage++;
            this.combo = 0;
            this.effect("hurt", CORE, "ЯДРО ПОВРЕЖДЕНО");
          }
          this.coach(
            entity.kind === "orb"
              ? "Поставь открытую ладонь на траекторию снаряда перед ядром"
              : "Проведи разрез через кристалл до его приближения к ядру",
          );
          if (this.health <= 0) this.finish(false);
          continue;
        }
      }
      if (
        entity.x < -0.15 ||
        entity.x > 1.15 ||
        entity.y < -0.2 ||
        entity.age > 13000
      )
        this.remove(entity);
    }
    if (this.elapsed > this.hintUntil) {
      this.hint = this.held
        ? "Взмахни к глазу и отпусти щипок, пока рука движется"
        : this.energy >= 100
          ? "Территория готова: сблизь две раскрытые ладони и удерживай"
          : this.phase === 2
            ? this.exposed
              ? "Глаз открыт! Возвращай снаряды и рассекай его"
              : "Глаз защищён. Лови его снаряды — бросок пробивает защиту"
            : "Синий снаряд — поймай щипком. Кристалл — пересеки разрезом.";
      const nearest = this.entities.find(
        (e) => e.team === "enemy" && distance(e, input.position) < 0.12,
      );
      if (
        nearest &&
        !input.pinching &&
        !input.shield &&
        !input.slash &&
        input.extended > 0 &&
        input.extended < 4
      )
        this.hint =
          nearest.kind === "orb"
            ? "Сведи большой и указательный пальцы плотнее, чтобы захватить снаряд"
            : "Раскрой ладонь перед разрезом: выпрями все четыре пальца";
    }
  }

  private aim(entity: Entity, target: Point, speed: number) {
    const d = Math.max(0.001, distance(entity, target));
    entity.vx = ((target.x - entity.x) / d) * speed;
    entity.vy = ((target.y - entity.y) / d) * speed;
  }
  private release(velocity: Point) {
    const e = this.held!;
    this.heldId = null;
    this.stats.throws++;
    const speed = length(velocity);
    if (speed < 0.4) {
      e.team = "enemy";
      e.charged = false;
      this.aim(e, CORE, 0.13);
      this.stats.weakThrows++;
      this.coach(
        "Бросок слишком слабый. Разомкни пальцы во время взмаха, а не после остановки.",
      );
      return;
    }
    e.team = "friendly";
    e.source = "throw";
    e.age = 0;
    e.vx = velocity.x * 1.15;
    e.vy = velocity.y * 1.15;
    const toward = { x: BOSS.x - e.x, y: BOSS.y - e.y };
    const cosine =
      (velocity.x * toward.x + velocity.y * toward.y * 0.49) /
      Math.max(0.001, speed * length(toward));
    if (cosine > 0.72) this.aim(e, BOSS, Math.max(0.65, speed));
    this.effect("throw", e);
  }
  private slash(slash: Slash) {
    const continuation = slash.id !== undefined && slash.id === this.strokeId;
    if (!continuation) {
      this.stats.cuts++;
      this.strokeHits.clear();
      this.strokeCounted = false;
      this.multiCounted = false;
      this.strokeMissAt = this.elapsed + 320;
      this.strokeId = slash.id;
    }
    let hits = 0;
    this.events.push({
      type: "slash",
      position: slash.from,
      to: slash.to,
      continuation,
    });
    for (const e of [...this.entities])
      if (
        e.team === "enemy" &&
        !this.strokeHits.has(e.id) &&
        segmentDistance(e, slash.from, slash.to) < e.r + 0.024
      ) {
        if (e.kind === "orb") continue;
        e.hp--;
        hits++;
        this.strokeHits.add(e.id);
        if (e.hp <= 0) {
          this.destroy(e, "swipe");
          if (this.practice === "swipe") this.practiceDone = true;
        } else {
          this.effect("break", e, "БРОНЯ СНЯТА");
          this.coach("Броня треснула — ещё один разрез или заряженный снаряд");
        }
      }
    if (
      this.exposed &&
      !this.strokeHits.has(-1) &&
      segmentDistance(BOSS, slash.from, slash.to) < 0.11
    ) {
      this.bossDamage(12);
      this.reward("swipe", 90);
      hits++;
      this.strokeHits.add(-1);
    }
    if (hits && !this.strokeCounted) {
      this.stats.cutHits++;
      this.strokeCounted = true;
    }
    if (hits && this.strokeHits.size > 1 && !this.multiCounted) {
      this.stats.multikills++;
      this.multiCounted = true;
      this.effect("break", slash.to, `РАЗРЕЗ ×${this.strokeHits.size}`);
    }
  }
  private reward(gesture: Lesson, base: number) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.lastHit = this.elapsed;
    const varied = this.lastGesture !== null && this.lastGesture !== gesture;
    this.score += base + Math.min(8, this.combo) * 10 + (varied ? 25 : 0);
    this.energy = Math.min(100, this.energy + (varied ? 13 : 8));
    this.lastGesture = gesture;
  }
  private destroy(e: Entity, gesture: Lesson) {
    this.remove(e);
    this.reward(gesture, e.kind === "armored" ? 150 : 90);
    this.effect("break", e);
  }
  private remove(e: Entity) {
    this.entities = this.entities.filter((other) => other.id !== e.id);
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
    this.effect(won ? "victory" : "defeat", BOSS);
  }
}
