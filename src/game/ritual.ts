import type { Point } from "../gestures";
import { clamp, length, type Control, type Slash } from "./control";

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
  failedDomain?: boolean;
  spear?: Point;
  bind?: boolean;
  cue?: "charge" | "armed" | "seal" | "fail";
};
export class Ritual {
  chargeMs = 0;
  charge = 0;
  vortex: Point | null = null;
  bladeHold = 0;
  bladeMs = 0;
  stage: "idle" | "release" = "idle";
  domainHold = 0;
  releaseHold = 0;
  ritualMs = 0;
  spearHold = 0;
  bindHold = 0;
  spearCooldown = 0;
  bindCooldown = 0;
  private extraLatched: "spear" | "bind" | null = null;
  hint = "";
  progress = 0;
  label = "";
  private ready = false;
  private fistMs = 0;
  private cooldown = 0;
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
    this.spearHold = 0;
    this.bindHold = 0;
    this.ritualMs = 0;
    this.hint = "";
    this.progress = 0;
    this.label = "";
  }
  pause(trackingLossMs?: number) {
    const stage = this.stage,
      elapsed = this.ritualMs,
      hold = this.domainHold,
      missed = this.domainMissMs + (trackingLossMs ?? 0);
    const latch =
      this.spearHold > 0
        ? "spear"
        : this.bindHold > 0
          ? "bind"
          : this.extraLatched;
    this.reset();
    this.stage = stage;
    this.ritualMs = elapsed;
    if (trackingLossMs !== undefined && stage === "idle" && missed <= 180) {
      this.domainHold = hold;
      this.domainMissMs = missed;
    }
    // Retain the accepted seal, but never count lost frames as its release.
    this.extraLatched = latch;
  }
  update(
    input: Control,
    dt: number,
    energy: number,
    allowed: string | null = null,
    extraLevel = 0,
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
    this.spearCooldown = Math.max(0, this.spearCooldown - dt);
    this.bindCooldown = Math.max(0, this.bindCooldown - dt);
    if (
      (this.extraLatched === "spear" && !input.spearSign) ||
      (this.extraLatched === "bind" && !input.bindPose)
    )
      this.extraLatched = null;
    const domainAvailable =
      energy >= 100 &&
      (!allowed || allowed === "domain") &&
      !this.vortex &&
      !this.cooldown;
    if (domainAvailable && this.stage === "idle") {
      // Two signed hands reserve the input before the single-hand blade can arm.
      const attempting =
        allowed === "domain" ||
        (input.twoHands && (input.bladeSign || input.secondSign));
      if (attempting) {
        this.label = "ТЕРРИТОРИЯ · ПЕЧАТЬ ТИГРА";
        this.hint = !input.twoHands
          ? "Покажи обе кисти целиком — нужны две руки."
          : !input.bladeSign || !input.secondSign
            ? "На каждой руке подними указательный и средний. Остальные пальцы согни."
            : !input.dualSign
              ? "Держи кисти рядом с небольшим зазором. Не перекрывай их."
              : "Печать верная. Удержи два знака до свечения.";
      }
      if (input.dualSign) {
        this.domainHold += dt;
        this.domainMissMs = 0;
      } else {
        this.domainMissMs += dt;
        if (this.domainMissMs > 180) this.domainHold = 0;
      }
      this.progress = this.domainHold / 700;
      if (input.dualSign && this.domainHold >= 700) {
        this.stage = "release";
        this.ritualMs = 0;
        this.bladeMs = this.bladeHold = 0;
        action.cue = "seal";
      } else if (attempting) {
        this.bladeMs = this.bladeHold = 0;
        return action;
      }
    } else if (this.stage === "idle") {
      this.domainHold = this.domainMissMs = 0;
    }
    if (this.stage === "release") {
      this.ritualMs += dt;
      if (allowed !== "domain" && this.ritualMs > 8000) {
        this.reset();
        this.hint =
          "Печать рассеялась. Снова подними указательный и средний на обеих руках, затем раскрой обе ладони.";
        this.errorMs = 2500;
        this.cooldown = 900;
        action.cue = "fail";
        action.failedDomain = true;
        return action;
      }
      this.label = "ТЕРРИТОРИЯ · РАСКРОЙ ЛАДОНИ";
      this.hint = !input.twoHands
        ? "Печать сохранена. Верни вторую руку в кадр."
        : !input.open || !input.secondOpen
          ? "Теперь раскрой все пальцы обеих рук. Разводить руки широко не нужно."
          : "Удержи раскрытые ладони — пространство подчиняется тебе.";
      this.releaseHold =
        input.twoHands && input.open && input.secondOpen
          ? this.releaseHold + dt
          : 0;
      this.progress = this.releaseHold / 350;
      if (this.releaseHold >= 350) {
        action.domain = true;
        this.reset();
        this.cooldown = 1200;
      }
      return action;
    }
    if (!allowed && extraLevel > 0 && !this.vortex && !this.cooldown) {
      if (input.bindPose && extraLevel >= 2) {
        this.bladeMs = this.bladeHold = this.spearHold = 0;
        this.label = "ПЕЧАТЬ ОКОВ";
        this.hint =
          this.bindCooldown > 0
            ? "Оковы восстанавливаются. Опусти руки или используй другую технику."
            : this.extraLatched
              ? "Печать принята. Сменяй позу перед следующим заклинанием."
              : "Кулак и ладонь рядом. Удержи — цепи остановят снаряды.";
        if (!this.bindCooldown && !this.extraLatched) this.bindHold += dt;
        this.progress = this.bindHold / 650;
        if (this.bindHold >= 650) {
          action.bind = true;
          this.bindCooldown = 10000;
          this.bindHold = 0;
          this.extraLatched = "bind";
        }
        return action;
      }
      this.bindHold = 0;
      if (input.spearSign) {
        this.bladeMs = this.bladeHold = 0;
        this.label = "КОПЬЁ РАЗЛОМА";
        this.hint =
          this.spearCooldown > 0
            ? "Копьё восстанавливается. Смени печать."
            : this.extraLatched
              ? "Опусти указательный палец перед следующим выстрелом."
              : "Наведи курсор на цель и удержи указательный и большой пальцы раскрытыми.";
        if (
          !this.spearCooldown &&
          !this.extraLatched &&
          length(input.velocity) < 0.8
        )
          this.spearHold += dt;
        else this.spearHold = 0;
        this.progress = this.spearHold / 600;
        if (this.spearHold >= 600) {
          action.spear = { ...input.position };
          this.spearCooldown = 3500;
          this.spearHold = 0;
          this.extraLatched = "spear";
        }
        return action;
      }
      this.spearHold = 0;
      if (input.extended === 1 && !input.pinching) {
        this.hint =
          "Для копья оставь указательный прямым и отведи большой палец в сторону. Остальные согни.";
      }
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
          : "На руке ① подними УКАЗАТЕЛЬНЫЙ и СРЕДНИЙ. Безымянный и мизинец согни. Щипок здесь не нужен.";
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
