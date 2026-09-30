import {
  Arena,
  BOSS,
  CORE,
  BEAM_CHARGE_MS,
  BEAM_HOLD_MS,
  type FX,
} from "./arena";
import { clamp, distance, DOMAIN_NEAR_DISTANCE, type Control } from "./control";
import type { Point } from "../gestures";
type Particle = Point & {
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rotation: number;
};
type Effect = FX & { age: number };
const TAU = Math.PI * 2;
/** All imagery is drawn locally: moving architecture, seals, debris and creatures. */
export class Scene {
  presentation = { mode: "idle", reveal: 0, tear: 0 };
  private c: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private effects: Effect[] = [];
  private previous = 0;
  private size = { width: 0, height: 0 };
  private glows = new Map<string, HTMLCanvasElement>();
  private backdrops = new Map<boolean, HTMLCanvasElement>();
  private vignette: HTMLCanvasElement | null = null;
  private quality = 1;
  private frameTotal = 0;
  private frameCount = 0;
  private qualityCheck = 0;
  private trail: Point[] = [];
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  private drawBeam(
    world: Arena,
    to: (p: Point) => Point,
    scale: number,
    time: number,
  ) {
    const beam = world.beam;
    if (!beam) return;
    const c = this.c,
      source = to(BOSS),
      target = to(beam.target),
      core = to(CORE);
    const charging = beam.stage === "charging",
      reflected = beam.stage === "reflected";
    const color =
      reflected || beam.hold >= BEAM_HOLD_MS ? "#9affdd" : "#ffb3cc";
    const radius = scale * 0.115;
    c.save();
    c.globalAlpha = charging ? 1 : Math.min(1, beam.remaining / 500);
    if (beam.stage === "dispelled") {
      this.seal(target.x, target.y, radius * 1.4, time * 0.3, "#edd5aa");
      c.restore();
      return;
    }
    const points = reflected ? [target, source] : [source, target, core];
    const path = () => {
      c.beginPath();
      c.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        for (let j = 1; j <= 10; j++) {
          const f = j / 10;
          const ripple =
            charging || this.reduced.matches || j === 10
              ? 0
              : Math.sin(j * 7 + time * 24) * 5;
          c.lineTo(a.x + (b.x - a.x) * f + ripple, a.y + (b.y - a.y) * f);
        }
      }
    };
    c.strokeStyle = color;
    c.lineJoin = "round";
    if (charging) {
      c.setLineDash([5, 9]);
      c.lineWidth = 1.5;
      path();
      c.stroke();
      c.setLineDash([]);
      this.halo(
        source.x,
        source.y,
        scale * (0.07 + 0.09 * (1 - beam.remaining / BEAM_CHARGE_MS)),
        "#ff92be45",
      );
    } else {
      for (const [width, alpha] of [
        [22, 0.12],
        [9, 0.5],
        [2, 1],
      ]) {
        c.lineWidth = width;
        c.globalAlpha = Math.min(1, beam.remaining / 500) * alpha;
        path();
        c.stroke();
      }
      c.globalAlpha = Math.min(1, beam.remaining / 500);
    }
    this.halo(
      target.x,
      target.y,
      radius * 1.8,
      reflected ? "#8effd93b" : "#ffa1c02b",
    );
    this.seal(target.x, target.y, radius, time * 0.2, color);
    c.lineWidth = 4;
    c.strokeStyle = "#9affdd";
    c.beginPath();
    c.arc(
      target.x,
      target.y,
      radius + 7,
      -Math.PI / 2,
      -Math.PI / 2 + (TAU * beam.hold) / BEAM_HOLD_MS,
    );
    c.stroke();
    if (charging) {
      c.fillStyle = "#fff0f7";
      c.font = "600 12px Manrope,sans-serif";
      c.textAlign = "center";
      c.fillText(
        beam.hold >= BEAM_HOLD_MS ? "ДЕРЖИ ДО ВЫСТРЕЛА" : "ЛАДОНЬ СЮДА",
        target.x,
        target.y + radius + 26,
      );
    }
    c.restore();
  }
  constructor(private canvas: HTMLCanvasElement) {
    this.c = canvas.getContext("2d", { alpha: false })!;
    new ResizeObserver(([entry]) => {
      this.size = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      this.backdrops.clear();
      this.vignette = null;
    }).observe(canvas);
  }
  emit(events: FX[]) {
    for (const e of events) {
      if (e.continuation) {
        const last = this.effects
          .slice()
          .reverse()
          .find((f) => f.type === "slash");
        if (last) last.to = e.to;
        continue;
      }
      this.effects.push({ ...e, age: 0 });
      if (this.reduced.matches) continue;
      const big = ["burst", "domain", "victory"].includes(e.type);
      const count = big ? 95 : e.type === "break" ? 28 : 12;
      const color = ["parry", "block"].includes(e.type)
        ? "#9affee"
        : e.type === "hurt"
          ? "#ff888b"
          : big
            ? "#dfc4ff"
            : "#bdadff";
      for (let i = 0; i < count; i++) {
        const a = Math.random() * TAU,
          speed = (big ? 0.25 : 0.06) + Math.random() * (big ? 0.55 : 0.25),
          life = 0.6 + Math.random() * 1.2;
        this.particles.push({
          ...e.position,
          vx: Math.cos(a) * speed,
          vy: (Math.sin(a) * speed) / 0.7,
          life,
          max: life,
          size: 1 + Math.random() * (big ? 6 : 4),
          color,
          rotation: Math.random() * TAU,
        });
      }
    }
    this.effects = this.effects.slice(-40);
    this.particles = this.particles.slice(-480);
  }
  private halo(x: number, y: number, r: number, color: string, c = this.c) {
    if (r <= 0) return;
    let glow = this.glows.get(color);
    if (!glow) {
      glow = document.createElement("canvas");
      glow.width = glow.height = 256;
      const g = glow.getContext("2d")!;
      const gradient = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "#00000000");
      g.fillStyle = gradient;
      g.fillRect(0, 0, 256, 256);
      this.glows.set(color, glow);
    }
    c.drawImage(glow, x - r, y - r, r * 2, r * 2);
  }
  private backdrop(w: number, h: number, domain: boolean) {
    let layer = this.backdrops.get(domain);
    if (!layer) {
      layer = document.createElement("canvas");
      const scale = Math.min(1, Math.sqrt(1_500_000 / (w * h)));
      layer.width = Math.ceil(w * scale);
      layer.height = Math.ceil(h * scale);
      const c = layer.getContext("2d")!;
      c.scale(scale, scale);
      this.halo(
        w * 0.5,
        h * 0.35,
        w * 0.65,
        domain ? "#46587a80" : "#3e1d6850",
        c,
      );
      // Broken cathedral, perspective floor and suspended masonry provide scale.
      const horizon = h * 0.43;
      const floor = c.createLinearGradient(0, horizon, 0, h);
      floor.addColorStop(0, "#40365310");
      floor.addColorStop(1, domain ? "#776c8c28" : "#211a352e");
      c.fillStyle = floor;
      c.fillRect(0, horizon, w, h);
      c.strokeStyle = domain ? "#d9d7eb22" : "#baa0e914";
      c.lineWidth = 0.7;
      for (let i = -9; i <= 9; i++) {
        c.beginPath();
        c.moveTo(w * 0.5 + i * 9, horizon);
        c.lineTo(w * 0.5 + (i * w) / 8, h);
        c.stroke();
      }
      for (let i = 0; i < 11; i++) {
        const y = horizon + Math.pow(i / 10, 2) * (h - horizon);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }
      this.backdrops.set(domain, layer);
    }
    this.c.drawImage(layer, 0, 0, w, h);
  }
  private seal(
    x: number,
    y: number,
    r: number,
    t: number,
    color: string,
    progress = 1,
  ) {
    const c = this.c;
    c.save();
    c.translate(x, y);
    c.rotate(t);
    c.strokeStyle = color;
    c.lineWidth = 1.2;
    for (const k of [1, 0.88, 0.62]) {
      c.beginPath();
      c.arc(0, 0, r * k, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(progress));
      c.stroke();
    }
    for (let layer = 0; layer < 2; layer++) {
      c.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i * TAU) / 3 + layer * Math.PI,
          x = Math.cos(a) * r * 0.82,
          y = Math.sin(a) * r * 0.82;
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
    }
    for (let i = 0; i < 24 * progress; i++) {
      const a = (i * TAU) / 24;
      c.save();
      c.rotate(a);
      c.beginPath();
      c.moveTo(r * 0.91, -2);
      c.lineTo(r * 0.98, 2);
      if (i % 3 === 0) {
        c.moveTo(r * 0.94, -4);
        c.lineTo(r * 0.94, 4);
      }
      c.stroke();
      c.restore();
    }
    c.restore();
  }
  draw(world: Arena | null, input: Control, now: number) {
    const c = this.c,
      rect = this.size,
      ratio =
        Math.min(
          devicePixelRatio || 1,
          1.5,
          Math.sqrt(1_500_000 / Math.max(1, rect.width * rect.height)),
        ) * this.quality,
      w = rect.width,
      h = rect.height;
    if (!w || !h) return;
    const frameMs = now - this.previous;
    if (this.previous && frameMs > 0 && frameMs < 250) {
      this.frameTotal += frameMs;
      this.frameCount++;
    }
    if (now - this.qualityCheck > 2000) {
      if (this.frameCount > 20 && this.frameTotal / this.frameCount > 24)
        this.quality = Math.max(0.65, this.quality * 0.85);
      this.qualityCheck = now;
      this.frameTotal = this.frameCount = 0;
    }
    if (
      this.canvas.width !== Math.round(w * ratio) ||
      this.canvas.height !== Math.round(h * ratio)
    ) {
      this.canvas.width = Math.round(w * ratio);
      this.canvas.height = Math.round(h * ratio);
    }
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const dt = world?.paused
      ? 0
      : Math.min(0.06, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    const t = this.reduced.matches ? 0 : now / 1000,
      domain = !!world?.domainMs;
    const fieldW = Math.max(100, Math.min(w - 44, (h - 210) / 0.7)),
      fieldH = fieldW * 0.7;
    const ox = (w - fieldW) / 2,
      oy = 82 + Math.max(0, (h - 210 - fieldH) * 0.32);
    const to = (p: Point) => ({ x: ox + p.x * fieldW, y: oy + p.y * fieldH });
    const intro = ["idle", "loading", "awakening"].includes(
      this.presentation.mode,
    );
    const boss = to(intro ? { x: 0.5, y: 0.32 } : BOSS),
      core = to(CORE);
    const accent = domain
      ? "#f4ddb0"
      : world?.phase === 2
        ? "#f99fcc"
        : "#ba9dfb";
    c.fillStyle = domain ? "#090d19" : "#06070d";
    c.fillRect(0, 0, w, h);
    c.save();
    const impact = this.effects
      .slice()
      .reverse()
      .find(
        (f) =>
          ["burst", "hurt", "boss", "domain"].includes(f.type) && f.age < 0.35,
      );
    if (impact && !this.reduced.matches)
      c.translate(
        Math.sin(now * 0.07) * (1 - impact.age / 0.35) * 4,
        Math.cos(now * 0.1) * (1 - impact.age / 0.35) * 3,
      );
    this.backdrop(w, h, domain);
    if (domain) {
      // The floor separates into suspended slabs; an impossible horizon replaces it.
      for (let i = 0; i < 15; i++) {
        const x = w * 0.5 + Math.sin(i * 19.7) * w * 0.58;
        const y = h * 0.52 + (i % 5) * h * 0.085 + Math.sin(t * 0.45 + i) * 12;
        const size = 25 + (i % 4) * 21;
        c.save();
        c.translate(x, y);
        c.rotate(Math.sin(i) * 0.18);
        c.fillStyle = "#24273dc9";
        c.strokeStyle = "#f3d9ae60";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-size, -size * 0.17);
        c.lineTo(size * 0.35, -size * 0.45);
        c.lineTo(size, size * 0.15);
        c.lineTo(-size * 0.35, size * 0.4);
        c.closePath();
        c.fill();
        c.stroke();
        c.fillStyle = "#090b18";
        c.beginPath();
        c.moveTo(-size, -size * 0.17);
        c.lineTo(-size * 0.35, size * 0.4);
        c.lineTo(size, size * 0.15);
        c.lineTo(size, size * 0.35);
        c.lineTo(-size * 0.35, size * 0.65);
        c.lineTo(-size, size * 0.08);
        c.closePath();
        c.fill();
        c.restore();
      }
      this.halo(w * 0.5, h * 0.43, w * 0.5, "#c6a7df35");
      c.strokeStyle = "#eedbbc50";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, h * 0.43);
      c.lineTo(w, h * 0.43);
      c.stroke();
    }
    for (let side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const x = w * 0.5 + side * w * (0.23 + i * 0.095),
          cw = 16 + i * 10,
          top = h * 0.14 - i * 11,
          bottom = h * 0.65 + i * 35;
        const drift = domain
          ? Math.sin(t * 0.45 + i) * 20
          : Math.sin(t * 0.25 + i) * 3;
        c.save();
        c.translate(x, drift);
        c.fillStyle = domain ? "#bfb3d51b" : "#30283f44";
        c.strokeStyle = domain ? "#daccf04c" : "#9e87c725";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-cw, top + 15);
        c.lineTo(0, top - 8);
        c.lineTo(cw, top + 4);
        c.lineTo(cw, bottom);
        c.lineTo(-cw, bottom);
        c.closePath();
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(-cw, bottom * 0.62);
        c.lineTo(0, bottom * 0.62 - 13);
        c.lineTo(cw, bottom * 0.62 + 8);
        c.stroke();
        c.restore();
      }
    for (let i = 0; i < 90; i++) {
      const x = (i * 173.39) % w,
        y = (((i * 97.11 - t * (2 + (i % 5))) % h) + h) % h;
      c.globalAlpha = 0.15 + (i % 5) * 0.1;
      c.fillStyle = accent;
      c.fillRect(x, y, i % 9 === 0 ? 2 : 1, 1.4);
    }
    c.globalAlpha = 1;
    // Orbiting debris responds to the actual compression centre.
    const vortex = world?.magic.vortex ? to(world.magic.vortex) : null;
    for (let i = 0; i < 24; i++) {
      let x = w * 0.5 + Math.sin(i * 17.2) * fieldW * 0.56,
        y = oy + ((i * 71.23) % fieldH);
      if (vortex) {
        const a = i * 2.4 + t * (1 + (i % 3)) * 0.7,
          r =
            fieldW * (0.04 + (i % 7) * 0.023) * (1 - world!.magic.charge * 0.5);
        x = vortex.x + Math.cos(a) * r;
        y = vortex.y + Math.sin(a) * r * 0.55;
      } else y += Math.sin(t * 0.5 + i) * 7;
      c.save();
      c.translate(x, y);
      c.rotate(i + t * 0.12);
      c.fillStyle = vortex ? "#a38ac960" : "#6b5b8c2c";
      c.strokeStyle = vortex ? "#b9a5e0a0" : "#ac8ec537";
      c.beginPath();
      c.moveTo(-4, -7);
      c.lineTo(7, -2);
      c.lineTo(4, 8);
      c.lineTo(-7, 4);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    // Creature silhouette: horns, ribs, an eye and flowing tendrils.
    const r = fieldW * (intro ? 0.24 : 0.16),
      recoil = this.effects
        .slice()
        .reverse()
        .find((f) => f.type === "boss" && f.age < 0.45);
    c.save();
    c.translate(
      boss.x,
      boss.y - (recoil ? Math.sin((recoil.age / 0.45) * Math.PI) * 12 : 0),
    );
    const reveal = intro ? this.presentation.reveal : 1;
    c.globalAlpha = clamp(reveal * 1.5);
    this.halo(0, 0, r * 2.1, domain ? "#d2b7ff50" : "#7144bf45");
    this.seal(0, 0, r * 1.36, t * 0.07, `${accent}4d`);
    c.fillStyle = "#100d1d";
    c.strokeStyle = `${accent}8c`;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(-r * 0.62, r * 0.12);
    c.bezierCurveTo(
      -r * 0.9,
      -r * 0.3,
      -r * 0.66,
      -r * 0.65,
      -r * 1.05,
      -r * 1.3,
    );
    c.quadraticCurveTo(-r * 0.32, -r * 0.95, -r * 0.28, -r * 0.45);
    c.lineTo(0, -r * 0.72);
    c.lineTo(r * 0.28, -r * 0.45);
    c.quadraticCurveTo(r * 0.32, -r * 0.95, r * 1.05, -r * 1.3);
    c.bezierCurveTo(r * 0.66, -r * 0.65, r * 0.9, -r * 0.3, r * 0.62, r * 0.12);
    c.quadraticCurveTo(r * 0.5, r * 0.75, 0, r * 1.18);
    c.quadraticCurveTo(-r * 0.5, r * 0.75, -r * 0.62, r * 0.12);
    c.fill();
    c.stroke();
    for (let i = 0; i < 7; i++) {
      c.strokeStyle = `${accent}${i < 3 ? "60" : "2a"}`;
      c.beginPath();
      c.moveTo(-r * (0.58 - i * 0.055), r * (0.12 + i * 0.105));
      c.quadraticCurveTo(
        0,
        r * (0.35 + i * 0.13),
        r * (0.58 - i * 0.055),
        r * (0.12 + i * 0.105),
      );
      c.stroke();
      const x = (i - 3) * r * 0.17;
      c.beginPath();
      c.moveTo(x, r * 0.65);
      c.bezierCurveTo(
        x + Math.sin(t + i) * r * 0.2,
        r,
        x - r * 0.3,
        r * 1.4,
        x + Math.sin(t * 0.7 + i) * r * 0.3,
        r * 1.85,
      );
      c.stroke();
    }
    const eye = world?.exposed || world?.practice || intro ? 0.21 : 0.065;
    c.shadowColor = accent;
    c.shadowBlur = 25;
    c.fillStyle = accent;
    c.beginPath();
    c.moveTo(-r * 0.51, 0);
    c.quadraticCurveTo(0, -r * eye * 1.8, r * 0.51, 0);
    c.quadraticCurveTo(0, r * eye * 1.8, -r * 0.51, 0);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#080510";
    c.beginPath();
    c.ellipse(
      input.valid ? (input.position.x - 0.5) * r * 0.14 : 0,
      0,
      r * 0.065,
      r * eye * 0.95,
      0,
      0,
      TAU,
    );
    c.fill();
    if (recoil) {
      c.globalAlpha = 0.65 * (1 - recoil.age / 0.45);
      c.strokeStyle = "#fff1ff";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(-r * 0.65, -r * 0.4);
      c.lineTo(r * 0.6, r * 0.55);
      c.stroke();
    }
    c.restore();
    if (world) {
      if (world.attackWindowMs > 0 && world.beam?.stage !== "charging") {
        // A fixed target around the actual hit area; no extra particles or
        // camera movement, so the opening remains easy to aim at.
        const radius = fieldW * 0.11;
        c.save();
        c.strokeStyle = "#a5ffe0";
        c.lineWidth = 2;
        for (const x of [-1, 1])
          for (const y of [-1, 1]) {
            c.beginPath();
            c.moveTo(boss.x + x * radius, boss.y + y * radius * 0.45);
            c.lineTo(boss.x + x * radius, boss.y + y * radius * 0.7);
            c.lineTo(boss.x + x * radius * 0.7, boss.y + y * radius * 0.7);
            c.stroke();
          }
        c.font = "600 11px Manrope,sans-serif";
        c.textAlign = "center";
        c.fillStyle = "#c6ffe9";
        c.fillText("РАССЕКИ ГЛАЗ", boss.x, boss.y + radius + 18);
        c.restore();
      }
      if (!world.ended) this.drawBeam(world, to, fieldW, t);
      this.halo(core.x, core.y, fieldW * 0.11, "#73e4c52b");
      this.seal(core.x, core.y, fieldW * 0.05, t * 0.2, "#9ff4df");
      c.fillStyle = "#c8ffed";
      c.font = "9px Manrope,sans-serif";
      c.textAlign = "center";
      c.fillText("ЯДРО", core.x, core.y + fieldW * 0.07);
      for (const e of world.entities) {
        const p = to(e),
          er = e.r * fieldW,
          color =
            e.team === "friendly"
              ? "#a6ffe0"
              : e.kind === "orb"
                ? "#91bfff"
                : e.kind === "armored"
                  ? "#ffc793"
                  : "#dfacff";
        if (e.team === "enemy") {
          c.strokeStyle = e.telegraph > 0 ? "#ffaeb966" : "#dcb6df28";
          c.lineWidth = e.telegraph > 0 ? 1.5 : 0.8;
          c.setLineDash([4, 10]);
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(core.x, core.y);
          c.stroke();
          c.setLineDash([]);
        }
        this.halo(p.x, p.y, er * 3.7, `${color}35`);
        c.save();
        c.translate(p.x, p.y);
        c.strokeStyle = color;
        c.fillStyle = `${color}38`;
        c.lineWidth = 1.5;
        if (e.telegraph > 0) {
          c.globalAlpha = 0.5;
          this.seal(0, 0, er * 2.1, -t, color, 1);
          c.globalAlpha = 1;
        }
        if (e.kind === "orb") {
          c.shadowColor = color;
          c.shadowBlur = 14;
          c.beginPath();
          c.ellipse(
            0,
            0,
            er * 0.6,
            er * 1.6,
            Math.atan2(e.vy, e.vx) - Math.PI / 2,
            0,
            TAU,
          );
          c.fill();
          c.stroke();
          c.fillStyle = "#effaff";
          c.beginPath();
          c.arc(0, 0, er * 0.3, 0, TAU);
          c.fill();
          c.shadowBlur = 0;
          c.strokeStyle = `${color}65`;
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(-e.vx * fieldW * 0.23, -e.vy * fieldH * 0.23);
          c.stroke();
        } else {
          c.rotate(t * 0.35 + e.id);
          c.beginPath();
          c.moveTo(0, -er * 1.5);
          c.lineTo(er, 0);
          c.lineTo(0, er * 1.5);
          c.lineTo(-er, 0);
          c.closePath();
          c.fill();
          c.stroke();
          c.beginPath();
          c.moveTo(0, -er * 1.5);
          c.lineTo(er * 0.3, 0);
          c.lineTo(0, er * 1.5);
          c.moveTo(-er, 0);
          c.lineTo(er, 0);
          c.stroke();
          if (e.hp > 1) {
            c.rotate(Math.PI / 4);
            c.strokeRect(-er, -er, er * 2, er * 2);
          }
        }
        c.restore();
      }
      if (vortex) {
        const charge = world.magic.charge,
          vr = fieldW * (0.08 + charge * 0.095);
        this.halo(vortex.x, vortex.y, vr * 3, "#a35cff70");
        c.save();
        c.translate(vortex.x, vortex.y);
        c.globalCompositeOperation = "lighter";
        for (let j = 0; j < 7; j++) {
          c.strokeStyle = j % 2 ? "#cfadffb0" : "#746affaa";
          c.lineWidth = 1 + (j % 3);
          c.beginPath();
          for (let i = 0; i < 55; i++) {
            const f = i / 54,
              a = f * TAU * 1.3 + (j * TAU) / 7 - t * 2.7,
              rr = vr * (1 - f) * 1.8,
              x = Math.cos(a) * rr,
              y = Math.sin(a) * rr * 0.65;
            if (i) c.lineTo(x, y);
            else c.moveTo(x, y);
          }
          c.stroke();
        }
        c.globalCompositeOperation = "source-over";
        c.fillStyle = "#05020f";
        c.beginPath();
        c.ellipse(0, 0, vr * 0.4, vr * 0.25, -0.3, 0, TAU);
        c.fill();
        this.seal(0, 0, vr * 1.25, -t * 0.8, "#f0cfff", charge);
        c.restore();
      }
      if (input.valid && !world.ended) {
        const p = to(input.position);
        if (world.shieldActive) {
          this.halo(p.x, p.y, fieldW * 0.17, "#78f2d334");
          this.seal(p.x, p.y, fieldW * 0.11, t * 0.35, "#b3ffea");
          this.seal(p.x, p.y, fieldW * 0.083, -t * 0.2, "#9ff1e055");
        }
        if (world.magic.bladeMs) {
          this.halo(p.x, p.y, 42, "#c184ff70");
          this.seal(p.x, p.y, 22, t, "#f4d9ff");
          c.strokeStyle = "#f7e7ff";
          c.lineWidth = 2;
          c.beginPath();
          c.moveTo(p.x - 5, p.y);
          c.lineTo(p.x - 3, p.y - 55);
          c.moveTo(p.x + 5, p.y);
          c.lineTo(p.x + 3, p.y - 55);
          c.stroke();
        }
        this.trail.push({ ...input.position });
        this.trail = this.trail.slice(-14);
        c.strokeStyle = "#dfc5ff77";
        c.lineWidth = 1.5;
        c.beginPath();
        this.trail.forEach((v, i) => {
          const q = to(v);
          if (i) c.lineTo(q.x, q.y);
          else c.moveTo(q.x, q.y);
        });
        c.stroke();
        c.fillStyle = "#f3e7ff";
        c.beginPath();
        c.arc(p.x, p.y, 3, 0, TAU);
        c.fill();
        if (world.magic.stage !== "idle") {
          if (world.magic.stage === "draw") {
            const center = to({ x: 0.5, y: 0.52 }),
              radius = fieldW * 0.22;
            c.save();
            c.strokeStyle = "#dfc5ff88";
            c.lineWidth = 1.4;
            c.setLineDash([5, 7]);
            c.beginPath();
            c.arc(center.x, center.y, radius, 0, TAU);
            c.stroke();
            c.setLineDash([]);
            for (let i = 0; i < 4; i++) {
              const a = (i * Math.PI) / 2,
                x = center.x + Math.cos(a) * radius,
                y = center.y + Math.sin(a) * radius;
              c.fillStyle = i === 0 ? "#f0d9ff" : "#b496d080";
              c.beginPath();
              c.arc(x, y, i === 0 ? 7 : 3, 0, TAU);
              c.fill();
            }
            c.font = "10px Manrope,sans-serif";
            c.textAlign = "center";
            c.fillStyle = "#f0d9ff";
            c.fillText("НАЧНИ ЗДЕСЬ", center.x + radius, center.y - 17);
            if (!world.magic.drawing && !this.reduced.matches) {
              const a = t * 1.2;
              c.fillStyle = "#dfb7ff";
              c.beginPath();
              c.arc(
                center.x + Math.cos(a) * radius,
                center.y + Math.sin(a) * radius,
                5,
                0,
                TAU,
              );
              c.fill();
            }
            c.restore();
          }
          const path = world.magic.path;
          c.strokeStyle = world.magic.circle?.ok
            ? "#ffdf9f"
            : world.magic.circle
              ? "#ff9aa8"
              : "#d5b6ff";
          c.lineWidth = 3;
          c.shadowColor = c.strokeStyle;
          c.shadowBlur = 16;
          c.beginPath();
          path.forEach((v, i) => {
            const q = to(v);
            if (i) c.lineTo(q.x, q.y);
            else c.moveTo(q.x, q.y);
          });
          c.stroke();
          c.shadowBlur = 0;
          if (world.magic.circle?.ok) {
            const center = to(world.magic.circle.center);
            this.seal(
              center.x,
              center.y,
              world.magic.circle.radius * fieldW,
              t * 0.3,
              "#ffe0aa",
            );
          } else if (path.length) {
            const first = to(path[0]);
            c.setLineDash([2, 5]);
            c.beginPath();
            c.arc(first.x, first.y, 14, 0, TAU);
            c.stroke();
            c.setLineDash([]);
          }
        }
      } else this.trail = [];
    }
    for (const f of this.effects) {
      f.age += dt;
      const p = to(f.position),
        fade = clamp(1 - f.age / (f.type === "domain" ? 3 : 1.3));
      c.save();
      c.globalAlpha = fade;
      if (f.type === "slash" && f.to) {
        const end = to(f.to),
          cut = f.age > 0.22;
        c.strokeStyle = cut ? "#ffefff" : "#d2a1ff";
        c.shadowColor = "#a153ff";
        c.shadowBlur = cut ? 35 : 12;
        c.lineWidth = cut ? Math.max(1, 12 * (1 - f.age / 1.3)) : 2;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(end.x, end.y);
        c.stroke();
        c.shadowBlur = 0;
        if (cut) {
          c.strokeStyle = "#140b20";
          c.lineWidth = 3;
          c.stroke();
          for (let i = 1; i < 7; i++) {
            const x = p.x + ((end.x - p.x) * i) / 7,
              y = p.y + ((end.y - p.y) * i) / 7;
            c.strokeStyle = "#d29fff";
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, y);
            c.lineTo(x + Math.sin(i * 3) * 25, y - 20);
            c.lineTo(x + Math.sin(i * 3) * 35, y - 30);
            c.stroke();
          }
        }
      } else if (f.type === "burst") {
        const r = Math.min(f.age * 0.95, 0.3 + (f.power ?? 1) * 0.35) * fieldW;
        this.halo(p.x, p.y, Math.max(1, r), "#a786ff35");
        c.strokeStyle = "#e7d7ff";
        c.lineWidth = Math.max(1, 13 * (1 - f.age / 1.3));
        c.shadowColor = "#9864ff";
        c.shadowBlur = 25;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, TAU);
        c.stroke();
        c.shadowBlur = 0;
        for (let i = 0; i < 2; i++) {
          c.strokeStyle = "#c7a8ff66";
          c.lineWidth = 1;
          c.beginPath();
          c.ellipse(p.x, p.y, r * (1 + i * 0.1), r * 0.42, i * 0.4, 0, TAU);
          c.stroke();
        }
      } else if (["parry", "block", "hurt"].includes(f.type)) {
        this.seal(
          p.x,
          p.y,
          fieldW * (0.05 + f.age * 0.12),
          f.age * 2,
          f.type === "hurt" ? "#ff9cad" : "#b8ffe8",
        );
        for (let i = 0; i < 8; i++) {
          const a = (i * TAU) / 8;
          c.strokeStyle = f.type === "hurt" ? "#ff8795" : "#d1fff2";
          c.beginPath();
          c.moveTo(p.x + Math.cos(a) * 15, p.y + Math.sin(a) * 15);
          c.lineTo(
            p.x + Math.cos(a + 0.1) * fieldW * 0.13 * f.age,
            p.y + Math.sin(a + 0.1) * fieldW * 0.13 * f.age,
          );
          c.stroke();
        }
      }
      if (f.text && !["domain", "phase"].includes(f.type)) {
        const damage = f.type === "boss" && f.text.startsWith("−");
        c.font = damage
          ? "700 24px Manrope,sans-serif"
          : "600 11px Manrope,sans-serif";
        c.textAlign = "center";
        c.fillStyle = damage ? "#c6ffe9" : "#eee0ff";
        c.fillText(
          f.text,
          p.x + (damage ? fieldW * 0.14 : 0),
          p.y - 25 - f.age * 25,
        );
      }
      c.restore();
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      const q = to(p);
      c.save();
      c.globalAlpha = clamp(p.life / p.max);
      c.translate(q.x, q.y);
      c.rotate(p.rotation + p.life);
      c.fillStyle = p.color;
      c.beginPath();
      c.moveTo(-p.size, 0);
      c.lineTo(p.size, -p.size * 0.4);
      c.lineTo(0, p.size);
      c.fill();
      c.restore();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.effects = this.effects.filter(
      (f) => f.age < (f.type === "domain" ? 3 : 1.3),
    );
    if (domain) {
      c.save();
      c.globalAlpha = 0.5;
      this.seal(
        w * 0.5,
        h * 0.48,
        Math.max(w, h) * 0.42,
        -t * 0.06,
        "#ebd3a877",
      );
      c.restore();
      const portal = this.effects.find((f) => f.type === "domain");
      if (portal && !this.reduced.matches) {
        c.fillStyle = `rgba(224,207,255,${Math.max(0, 0.32 - portal.age * 0.3)})`;
        c.fillRect(0, 0, w, h);
      }
    }
    if (intro) {
      c.fillStyle = `rgba(3,4,8,${1 - clamp(this.presentation.reveal)})`;
      c.fillRect(0, 0, w, h);
      if (
        this.presentation.mode === "awakening" &&
        this.presentation.reveal >= 1
      ) {
        const tear = this.presentation.tear;
        c.strokeStyle = "#d2b7ff";
        c.shadowColor = "#b07aff";
        c.shadowBlur = 24;
        c.lineWidth = 2 + tear * 8;
        c.beginPath();
        c.moveTo(w * 0.5 - w * 0.35 * tear, h * 0.4);
        c.lineTo(w * 0.5 + w * 0.35 * tear, h * 0.4);
        c.stroke();
        c.shadowBlur = 0;
        if (input.twoHands && input.secondPosition) {
          const a = to(input.position),
            b = to(input.secondPosition);
          this.seal(a.x, a.y, 28, t * 0.4, "#d9c1ff");
          this.seal(b.x, b.y, 28, -t * 0.4, "#d9c1ff");
          c.strokeStyle = "#dfcaff77";
          c.beginPath();
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
          c.stroke();
        }
      }
    }
    c.restore();
    if (!this.vignette) {
      const layer = document.createElement("canvas");
      const scale = Math.min(1, Math.sqrt(1_500_000 / (w * h)));
      layer.width = Math.ceil(w * scale);
      layer.height = Math.ceil(h * scale);
      const v = layer.getContext("2d")!;
      v.scale(scale, scale);
      const gradient = v.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.22,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.7,
      );
      gradient.addColorStop(0, "#00000000");
      gradient.addColorStop(1, "#02030bcc");
      v.fillStyle = gradient;
      v.fillRect(0, 0, w, h);
      this.vignette = layer;
    }
    c.drawImage(this.vignette, 0, 0, w, h);
    // Both tracked hands stay visible. Numbers refer to roles, not mirrored left/right.
    if (
      input.valid &&
      (!intro || this.presentation.reveal >= 1) &&
      !world?.ended
    ) {
      if (
        world &&
        !world.practiceDone &&
        (world.practice === "domain" ||
          (!world.practice && world.energy >= 100)) &&
        !world.domainMs &&
        world.magic.stage === "idle" &&
        input.secondPosition
      ) {
        const a = to(input.position),
          b = to(input.secondPosition);
        const gap = distance(input.position, input.secondPosition);
        const near = gap <= DOMAIN_NEAR_DISTANCE;
        const bothOpen = input.open && input.secondOpen;
        const color = input.domainPose ? "#95f4dd" : "#f4ce92";
        const x = clamp((a.x + b.x) / 2, 115, w - 115);
        const y = Math.max(100, Math.min(a.y, b.y) - 52);
        c.save();
        c.strokeStyle = color;
        c.lineWidth = input.domainPose ? 3 : 2;
        c.setLineDash(input.domainPose ? [] : [5, 7]);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = "#100b1de6";
        c.fillRect(x - 110, y - 15, 220, 40);
        c.fillStyle = color;
        c.font = "bold 11px Manrope,sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(
          !bothOpen
            ? "РАСКРОЙ ОБЕ ЛАДОНИ"
            : near
              ? "ВЕРНО · УДЕРЖИ ЛАДОНИ"
              : `СБЛИЗЬ · ЕЩЁ ${Math.ceil((1 - DOMAIN_NEAR_DISTANCE / gap) * 100)}%`,
          x,
          y,
        );
        c.fillStyle = "#ffffff22";
        c.fillRect(x - 92, y + 13, 184, 3);
        c.fillStyle = color;
        c.fillRect(
          x - 92,
          y + 13,
          184 *
            (near
              ? clamp(world.magic.domainHold / 700)
              : clamp(DOMAIN_NEAR_DISTANCE / gap)),
          3,
        );
        c.restore();
      }
      const cursor = (
        point: Point,
        number: number,
        color: string,
        active: boolean,
      ) => {
        const p = to(point);
        c.save();
        c.strokeStyle = color;
        c.fillStyle = "#100b1de6";
        c.lineWidth = 2;
        c.shadowColor = color;
        c.shadowBlur = active ? 16 : 4;
        c.beginPath();
        c.arc(p.x, p.y, active ? 16 : 12, 0, TAU);
        c.fill();
        c.stroke();
        c.shadowBlur = 0;
        c.fillStyle = color;
        c.font = "bold 12px Manrope,sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(String(number), p.x, p.y);
        c.font = "9px Manrope,sans-serif";
        c.fillText(
          number === 1
            ? input.pinching
              ? "РИСУЮ"
              : "ТВОЯ МАГИЯ"
            : "ВТОРАЯ РУКА",
          p.x,
          p.y + 25,
        );
        if (
          number === 1 &&
          world?.practice === "swipe" &&
          !world.magic.bladeMs &&
          world.magic.bladeHold > 0
        ) {
          c.beginPath();
          c.arc(
            p.x,
            p.y,
            20,
            -Math.PI / 2,
            -Math.PI / 2 + TAU * clamp(world.magic.bladeHold / 300),
          );
          c.stroke();
        }
        c.restore();
      };
      cursor(
        input.position,
        1,
        "#edc6ff",
        input.pinching || !!world?.magic.bladeMs,
      );
      if (input.secondPosition)
        cursor(input.secondPosition, 2, "#95f4dd", input.secondOpen);
    }
  }
}
