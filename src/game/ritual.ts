import type { Point } from "../gestures";
import { clamp, distance, length, type Control, type Slash } from "./control";

export type CircleResult = {
  ok: boolean;
  hint: string;
  center: Point;
  radius: number;
};
/** Shape checks use the same aspect-corrected coordinates as the arena. */
export function inspectCircle(path: Point[]): CircleResult {
  const fail = (hint: string): CircleResult => ({
    ok: false,
    hint,
    center: { x: 0.5, y: 0.5 },
    radius: 0,
  });
  if (path.length < 12) return fail("Нарисуй целый круг, удерживая щипок.");
  const xs = path.map((p) => p.x),
    ys = path.map((p) => p.y * 0.7);
  const width = Math.max(...xs) - Math.min(...xs),
    height = Math.max(...ys) - Math.min(...ys);
  if (Math.min(width, height) < 0.12)
    return fail("Сделай круг крупнее — расширь движение кисти.");
  if (Math.max(width, height) / Math.min(width, height) > 2)
    return fail("Расширь узкую сторону печати: нужен округлый контур.");
  const center = {
    x: (Math.max(...xs) + Math.min(...xs)) / 2,
    y: (Math.max(...ys) + Math.min(...ys)) / 1.4,
  };
  const radii = path.map((p) => distance(p, center)),
    radius = radii.reduce((a, b) => a + b, 0) / path.length;
  if (distance(path[0], path[path.length - 1]) > radius * 0.55)
    return {
      ...fail("Соедини конец линии с её началом — печать не замкнута."),
      center,
      radius,
    };
  let sweep = 0,
    travel = 0;
  for (let i = 1; i < path.length; i++) {
    const a = Math.atan2(
      (path[i - 1].y - center.y) * 0.7,
      path[i - 1].x - center.x,
    );
    const b = Math.atan2((path[i].y - center.y) * 0.7, path[i].x - center.x);
    const step = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    sweep += step;
    travel += Math.abs(step);
  }
  if (
    Math.abs(sweep) < Math.PI * 1.65 ||
    travel > Math.PI * 3.5 ||
    radii.reduce((s, r) => s + Math.abs(r - radius), 0) / path.length / radius >
      0.3
  )
    return {
      ...fail("Обведи центр одним плавным кругом, без пересечений."),
      center,
      radius,
    };
  return {
    ok: true,
    hint: "Печать замкнута. Разведи две открытые ладони.",
    center,
    radius,
  };
}

export class Awakening {
  elapsed = 0;
  hold = 0;
  armed = false;
  complete = false;
  spread = 0;
  private armedMs = 0;
  hint = "Он почувствовал твоё присутствие.";
  update(input: Control, dt: number) {
    this.elapsed += dt;
    if (this.elapsed < 4200 || this.complete) return;
    if (!input.valid) {
      this.hold = 0;
      this.armed = false;
      this.hint = "Покажи обе руки целиком перед камерой.";
      return;
    }
    if (!this.armed) {
      this.hold = input.dualSign
        ? this.hold + dt
        : Math.max(0, this.hold - dt * 2);
      this.hint =
        "Подними указательный и средний пальцы на обеих руках. Держи руки рядом, не перекрывая их.";
      if (this.hold >= 650) {
        this.armed = true;
        this.armedMs = 0;
      }
    } else {
      this.armedMs += dt;
      this.hint = "Печать принята. Разведи руки в стороны — разорви завесу.";
      this.spread = clamp(((input.handGap ?? 0) - 0.18) / 0.19);
      if (input.twoHands && this.spread >= 1) this.complete = true;
      if (this.armedMs > 4500) {
        this.armed = false;
        this.hold = 0;
      }
    }
  }
}

export type MagicAction = {
  burst?: { position: Point; power: number };
  slash?: Slash;
  domain?: boolean;
  cue?: "charge" | "armed" | "seal" | "fail";
};
export class Ritual {
  chargeMs = 0;
  charge = 0;
  vortex: Point | null = null;
  bladeHold = 0;
  bladeMs = 0;
  stage: "idle" | "draw" | "release" = "idle";
  domainHold = 0;
  releaseHold = 0;
  ritualMs = 0;
  path: Point[] = [];
  drawing = false;
  circle: CircleResult | null = null;
  hint = "";
  progress = 0;
  label = "";
  private ready = false;
  private fistMs = 0;
  private cooldown = 0;
  private lastPinch = false;
  private strokeId: number | undefined;
  private errorMs = 0;
  private domainMissMs = 0;
  reset() {
    this.chargeMs = 0;
    this.charge = 0;
    this.vortex = null;
    this.fistMs = 0;
    this.ready = false;
    this.bladeHold = 0;
    this.bladeMs = 0;
    this.stage = "idle";
    this.domainHold = 0;
    this.domainMissMs = 0;
    this.releaseHold = 0;
    this.path = [];
    this.drawing = false;
    this.lastPinch = false;
    this.circle = null;
    this.hint = "";
    this.progress = 0;
    this.label = "";
  }
  pause(trackingLossMs?: number) {
    const stage = this.stage,
      circle = this.circle,
      path = this.path,
      elapsed = this.ritualMs,
      hold = this.domainHold,
      missed = this.domainMissMs + (trackingLossMs ?? 0);
    this.reset();
    this.stage = stage;
    this.ritualMs = elapsed;
    // A few missed camera frames must not erase a nearly completed seal.
    // Explicit pauses still reset it; missing input never advances the hold.
    if (trackingLossMs !== undefined && stage === "idle" && missed <= 180) {
      this.domainHold = hold;
      this.domainMissMs = missed;
    }
    if (stage === "release") {
      this.circle = circle;
      this.path = path;
    }
    if (stage === "draw") {
      this.hint =
        "Рука пропала из кадра. Первая печать сохранена — начни круг заново щипком.";
      this.errorMs = 3000;
    }
  }
  update(
    input: Control,
    dt: number,
    energy: number,
    allowed: string | null = null,
  ): MagicAction {
    const action: MagicAction = {};
    if (!input.valid) {
      this.pause(dt);
      return action;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.errorMs = Math.max(0, this.errorMs - dt);
    this.bladeMs = Math.max(0, this.bladeMs - dt);
    this.label = "";
    this.progress = 0;
    if (!this.errorMs) this.hint = "";
    if (input.open) this.ready = true;
    if (
      energy >= 100 &&
      (!allowed || allowed === "domain") &&
      !this.vortex &&
      this.stage === "idle"
    ) {
      this.label = "1 / 3 · ДВЕ ОТКРЫТЫЕ ЛАДОНИ";
      if (!this.errorMs)
        this.hint = !input.twoHands
          ? "Покажи ОБЕ руки: на экране должны быть курсоры ① и ②."
          : !input.open || !input.secondOpen
            ? "Раскрой все пальцы на ОБЕИХ руках. Здесь нужны ладони, а не знак ✌."
            : !input.domainPose
              ? "Подвинь обе ладони к центру до зелёной связи между курсорами. Совмещать руки не нужно."
              : "Достаточно близко! Остановись и удержи раскрытые ладони до заполнения полоски.";
      if (input.domainPose) {
        this.domainHold += dt;
        this.domainMissMs = 0;
      } else {
        this.domainMissMs += dt;
        if (this.domainMissMs > 180) this.domainHold = 0;
      }
      if (this.domainHold > 0) {
        this.label = "ТЕРРИТОРИЯ · ПЕРВАЯ ПЕЧАТЬ";
        this.progress = this.domainHold / 700;
      }
      if (input.domainPose && this.domainHold >= 700) {
        this.stage = "draw";
        this.ritualMs = 0;
        this.path = [];
        this.lastPinch = input.pinching;
        this.bladeMs = 0;
        action.cue = "seal";
      }
    } else if (this.stage === "idle") {
      this.domainHold = 0;
      this.domainMissMs = 0;
    }
    if (this.stage !== "idle") {
      this.ritualMs += dt;
      if (allowed !== "domain" && this.ritualMs > 18000) {
        this.reset();
        this.hint = "Ритуал рассеялся. Сблизь открытые ладони и начни снова.";
        this.errorMs = 2500;
        return action;
      }
      if (this.stage === "draw") {
        this.label = "ТЕРРИТОРИЯ · НАРИСУЙ КРУГ";
        if (!this.errorMs)
          this.hint = input.fist
            ? "Для щипка соедини большой и указательный. Остальные три пальца оставь выпрямленными."
            : this.drawing
              ? "Веди курсор ① по кругу, удерживая щипок. Вернись к началу и разомкни пальцы."
              : "Рисует рука ①. Соедини БОЛЬШОЙ и УКАЗАТЕЛЬНЫЙ пальцы и обведи пунктир кистью. Вторую руку можно опустить.";
        if (input.pinching && !this.lastPinch) {
          this.path = [];
          this.drawing = true;
          this.circle = null;
          this.errorMs = 0;
        }
        if (
          input.pinching &&
          this.drawing &&
          (this.path.length === 0 ||
            distance(input.position, this.path[this.path.length - 1]) > 0.006)
        ) {
          this.path.push({ ...input.position });
          if (this.path.length > 600) {
            this.drawing = false;
            this.hint =
              "Один круг — одна печать. Отпусти щипок и попробуй снова.";
            this.errorMs = 2500;
          }
        }
        if (!input.pinching && this.lastPinch && this.drawing) {
          this.drawing = false;
          this.circle = inspectCircle(this.path);
          this.hint = this.circle.hint;
          if (this.circle.ok) {
            this.stage = "release";
            this.releaseHold = 0;
            action.cue = "seal";
          } else {
            this.errorMs = 2600;
            action.cue = "fail";
          }
        }
        this.progress = clamp(this.path.length / 65);
      } else {
        this.label = "ТЕРРИТОРИЯ · РАСКРОЙ ПРОСТРАНСТВО";
        this.hint = !input.twoHands
          ? "Круг готов. Теперь покажи ОБЕ руки — нужны два курсора."
          : !input.open || !input.secondOpen
            ? "Круг готов. Раскрой все пальцы ОБЕИХ ладоней."
            : "Разводи курсоры ① и ② в стороны и удержи ладони открытыми.";
        this.releaseHold =
          input.open && input.secondOpen && (input.handGap ?? 0) > 0.3
            ? this.releaseHold + dt
            : 0;
        this.progress = this.releaseHold / 400;
        if (this.releaseHold >= 400) {
          action.domain = true;
          this.reset();
          this.cooldown = 1200;
        }
      }
      this.lastPinch = input.pinching;
      return action;
    }
    if ((!allowed || allowed === "vortex") && !this.cooldown) {
      if (input.fist && this.ready) {
        this.fistMs += dt;
        if (this.fistMs >= 300) {
          if (!this.vortex) {
            this.vortex = { ...input.position };
            action.cue = "charge";
          }
          this.chargeMs += dt;
          this.charge = clamp(this.chargeMs / 1600);
          this.label = "СЖАТИЕ · НАКОПЛЕНИЕ";
          this.progress = this.charge;
          this.hint =
            this.chargeMs < 700
              ? "Держи кулак: обломки собираются в воронку."
              : "Раскрой ладонь — выпусти ударную волну.";
          if (this.chargeMs > 3500) {
            this.reset();
            this.cooldown = 900;
            this.hint =
              "Энергия рассеялась. Раскрой ладонь после заполнения печати.";
            this.errorMs = 2500;
            action.cue = "fail";
          }
        }
      } else if (this.vortex) {
        if (input.open) {
          if (this.chargeMs >= 700)
            action.burst = { position: { ...this.vortex }, power: this.charge };
          else {
            this.hint =
              "Слишком рано: удерживай кулак до заполнения внутреннего кольца.";
            this.errorMs = 2300;
            action.cue = "fail";
          }
          this.vortex = null;
          this.charge = 0;
          this.chargeMs = 0;
          this.fistMs = 0;
          this.ready = false;
          this.cooldown = 900;
        } else {
          this.hint = "Для выброса раскрой все пальцы ладони.";
          this.chargeMs += dt;
          if (this.chargeMs > 4000) {
            this.reset();
            this.cooldown = 900;
          }
        }
      } else this.fistMs = 0;
    }
    if ((!allowed || allowed === "swipe") && !this.vortex && !this.cooldown) {
      this.bladeHold =
        input.bladeSign && length(input.velocity) < 0.8
          ? this.bladeHold + dt
          : 0;
      if (this.bladeHold >= 300 && !this.bladeMs) {
        this.bladeMs = 5000;
        action.cue = "armed";
        this.strokeId = undefined;
      }
      if (allowed === "swipe" && !this.bladeMs && !this.errorMs) {
        this.label = "1 / 2 · ПЕЧАТЬ ДВУХ ПАЛЬЦЕВ";
        this.progress = this.bladeHold / 300;
        this.hint = input.bladeSign
          ? "Поза верная. На мгновение останови кисть."
          : "На руке ① подними УКАЗАТЕЛЬНЫЙ и СРЕДНИЙ (✌). Безымянный и мизинец согни. Щипок здесь не нужен.";
      }
      if (this.bladeMs > 0) {
        this.label = "РАЗРЕЗ · ПЕЧАТЬ ПРИНЯТА";
        this.progress = 1;
        this.hint = "Проведи двумя пальцами или открытой ладонью через цель.";
        if (input.slash) {
          if (this.strokeId === undefined) this.strokeId = input.slash.id;
          if (input.slash.id === this.strokeId) {
            action.slash = input.slash;
            this.bladeHold = 0;
            this.bladeMs = Math.min(this.bladeMs, 260);
          }
        }
      } else if (input.slash) {
        this.hint = "Перед разрезом удержи два пальца: указательный и средний.";
        this.errorMs = 1600;
      }
    }
    return action;
  }
}
