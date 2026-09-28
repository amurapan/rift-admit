import { Arena, BOSS, CORE, type FX } from "./arena";
import type { Control } from "./control";
import type { Point } from "../gestures";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
};
type Effect = FX & { age: number };

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private effects: Effect[] = [];
  private trail: Point[] = [];
  private previous = 0;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }
  emit(events: FX[]) {
    for (const event of events) {
      this.effects.push({ ...event, age: 0 });
      if (this.reduced.matches) continue;
      const color = ["block", "parry"].includes(event.type)
        ? "#a8f4df"
        : ["hurt", "defeat"].includes(event.type)
          ? "#ff8c87"
          : event.type === "domain"
            ? "#f4e4b0"
            : "#cfb0ff";
      const count =
        event.type === "domain" || event.type === "victory" ? 80 : 20;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2,
          speed = 0.04 + Math.random() * 0.21;
        this.particles.push({
          ...event.position,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 0.5 + Math.random() * 0.6,
          color,
          size: 1 + Math.random() * 3,
        });
      }
    }
    this.particles = this.particles.slice(-320);
    this.effects = this.effects.slice(-28);
  }
  draw(world: Arena | null, control: Control, now: number) {
    const c = this.ctx,
      rect = this.canvas.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2);
    if (
      this.canvas.width !== Math.round(rect.width * ratio) ||
      this.canvas.height !== Math.round(rect.height * ratio)
    ) {
      this.canvas.width = Math.round(rect.width * ratio);
      this.canvas.height = Math.round(rect.height * ratio);
    }
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = rect.width,
      h = rect.height,
      dt = Math.min(0.06, (now - this.previous) / 1000);
    this.previous = now;
    const t = this.reduced.matches ? 0 : now / 1000;
    c.clearRect(0, 0, w, h);
    const domain = !!world?.domainMs;
    const fieldH = Math.min(h - 305, (w - 32) * 0.7),
      fieldW = fieldH / 0.7;
    const ox = (w - fieldW) / 2,
      oy = 158 + (h - 305 - fieldH) / 2;
    const to = (p: Point) => ({ x: ox + p.x * fieldW, y: oy + p.y * fieldH });
    const boss = to(BOSS),
      core = to(CORE);
    const accent = domain
      ? "#e9dab5"
      : world?.phase === 2
        ? "#e994bc"
        : "#b49af3";
    const glow = c.createRadialGradient(
      boss.x,
      boss.y,
      5,
      boss.x,
      boss.y,
      fieldW * 0.56,
    );
    glow.addColorStop(0, domain ? "#ab83d536" : "#8259d926");
    glow.addColorStop(1, "#7541ad00");
    c.fillStyle = glow;
    c.fillRect(0, 0, w, h);
    // Perspective floor and stars form an arena rather than a flat gesture panel.
    c.lineWidth = 0.7;
    c.strokeStyle = domain ? "#cebcf537" : "#afa0df10";
    for (let i = -6; i <= 6; i++) {
      c.beginPath();
      c.moveTo(w / 2 + i * 12, oy + fieldH * 0.46);
      c.lineTo(w / 2 + (i * w) / 7, h);
      c.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const y = oy + fieldH * 0.46 + i * i * 6;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    for (let i = 0; i < 65; i++) {
      const x = (i * 163.33) % w,
        y = (((i * 71.71 - t * (2 + (i % 3))) % h) + h) % h;
      c.fillStyle = i % 5 === 0 ? "#ccafe76b" : "#ccafe726";
      c.fillRect(x, y, i % 5 === 0 ? 2 : 1, 1.5);
    }
    const ringR = fieldW * (world ? 0.14 : 0.21);
    const bossY = world ? boss.y : oy + fieldH * 0.42;
    c.save();
    c.translate(boss.x, bossY);
    for (let i = 0; i < 4; i++) {
      c.save();
      c.rotate(t * (i % 2 ? -0.12 : 0.08) + i * 0.8);
      c.strokeStyle = i === 0 ? accent : `${accent}40`;
      c.lineWidth = i === 0 ? 1.4 : 0.7;
      c.beginPath();
      c.ellipse(
        0,
        0,
        ringR * (1 + i * 0.14),
        ringR * (0.64 + i * 0.15),
        i * 0.5,
        0,
        Math.PI * 2,
      );
      c.stroke();
      if (i === 2)
        for (let n = 0; n < 24; n++) {
          const a = (n * Math.PI) / 12;
          c.beginPath();
          c.moveTo(Math.cos(a) * ringR * 1.37, Math.sin(a) * ringR * 1.37);
          c.lineTo(Math.cos(a) * ringR * 1.47, Math.sin(a) * ringR * 1.47);
          c.stroke();
        }
      c.restore();
    }
    // Procedural creature: crown, tendrils and an eye which opens during vulnerability.
    c.fillStyle = "#191025";
    c.strokeStyle = accent;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-ringR * 0.75, 0);
    c.lineTo(-ringR * 0.95, -ringR * 0.83);
    c.lineTo(-ringR * 0.3, -ringR * 0.42);
    c.lineTo(0, -ringR * 0.9);
    c.lineTo(ringR * 0.3, -ringR * 0.42);
    c.lineTo(ringR * 0.95, -ringR * 0.83);
    c.lineTo(ringR * 0.75, 0);
    c.quadraticCurveTo(0, ringR * 0.95, -ringR * 0.75, 0);
    c.fill();
    c.stroke();
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * ringR * 0.3;
      c.strokeStyle = `${accent}6a`;
      c.beginPath();
      c.moveTo(x, ringR * 0.35);
      c.bezierCurveTo(
        x + Math.sin(t + i) * 16,
        ringR * 0.8,
        x - 15,
        ringR * 0.9,
        x + Math.sin(t * 0.7 + i) * 22,
        ringR * 1.3,
      );
      c.stroke();
    }
    const openness = world?.exposed || world?.practice ? 0.31 : 0.07;
    c.fillStyle = accent;
    c.shadowColor = accent;
    c.shadowBlur = 18;
    c.beginPath();
    c.ellipse(0, 0, ringR * 0.55, ringR * openness, 0, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = "#170f22";
    c.beginPath();
    c.ellipse(
      Math.sin(t * 0.5) * 4,
      0,
      ringR * 0.07,
      ringR * openness * 0.9,
      0,
      0,
      Math.PI * 2,
    );
    c.fill();
    c.restore();
    if (world) {
      c.strokeStyle = "#8adbc4";
      c.lineWidth = 1.3;
      c.fillStyle = "#102e2c";
      c.beginPath();
      c.arc(core.x, core.y, fieldW * 0.053, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.save();
      c.translate(core.x, core.y);
      c.rotate(t * 0.3);
      c.strokeRect(
        -fieldW * 0.02,
        -fieldW * 0.02,
        fieldW * 0.04,
        fieldW * 0.04,
      );
      c.restore();
      c.fillStyle = "#8fc7b8";
      c.font = "8px Manrope, sans-serif";
      c.textAlign = "center";
      c.fillText("ЯДРО", core.x, core.y + fieldW * 0.075);
      for (const e of world.entities) {
        const p = to(e),
          r = e.r * fieldW;
        if (e.team === "enemy") {
          c.strokeStyle = "#dfadb322";
          c.setLineDash([3, 9]);
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(core.x, core.y);
          c.stroke();
          c.setLineDash([]);
        }
        const color =
          e.team === "friendly" || e.team === "held"
            ? e.charged
              ? "#f4d797"
              : "#b4efdf"
            : e.kind === "orb"
              ? "#8cbfff"
              : e.kind === "armored"
                ? "#f2b580"
                : "#dc9be7";
        c.save();
        c.translate(p.x, p.y);
        c.strokeStyle = color;
        c.fillStyle = `${color}40`;
        c.lineWidth = 1.7;
        if (e.telegraph > 0) {
          c.globalAlpha = 0.55;
          c.setLineDash([3, 5]);
          c.beginPath();
          c.arc(0, 0, r + 6 + Math.sin(t * 6) * 3, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
        }
        c.shadowColor = color;
        c.shadowBlur = 16;
        if (e.kind === "orb") {
          c.beginPath();
          c.arc(0, 0, r, 0, Math.PI * 2);
          c.fill();
          c.stroke();
          c.fillStyle = "#fff5df";
          c.beginPath();
          c.arc(0, 0, r * 0.28, 0, Math.PI * 2);
          c.fill();
          if (e.team === "held") {
            c.beginPath();
            c.arc(
              0,
              0,
              r + 7,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * Math.min(1, world.heldMs / 650),
            );
            c.stroke();
          }
        } else {
          c.rotate(t * 0.45 + e.id);
          c.beginPath();
          c.moveTo(0, -r * 1.3);
          c.lineTo(r, 0);
          c.lineTo(0, r * 1.3);
          c.lineTo(-r, 0);
          c.closePath();
          c.fill();
          c.stroke();
          if (e.hp > 1) {
            c.rotate(Math.PI / 4);
            c.strokeRect(-r, -r, r * 2, r * 2);
          } else {
            c.beginPath();
            c.moveTo(-r, 0);
            c.lineTo(r, 0);
            c.moveTo(0, -r);
            c.lineTo(0, r);
            c.stroke();
          }
        }
        c.restore();
      }
      if (control.valid && !world.ended) {
        const p = to(control.position);
        if (world.shieldActive) {
          c.fillStyle = "#8ff2d510";
          c.strokeStyle = "#a3f4dd";
          c.shadowColor = "#74eec6";
          c.shadowBlur = 14;
          c.lineWidth = 2;
          c.beginPath();
          for (let i = 0; i <= 6; i++) {
            const a = (i * Math.PI) / 3;
            const x = p.x + Math.cos(a) * fieldW * 0.1,
              y = p.y + Math.sin(a) * fieldW * 0.1;
            if (i) c.lineTo(x, y);
            else c.moveTo(x, y);
          }
          c.fill();
          c.stroke();
          c.shadowBlur = 0;
          c.strokeStyle = "#a3f4dd55";
          c.beginPath();
          c.arc(p.x, p.y, fieldW * 0.074, 0, Math.PI * 2);
          c.stroke();
        }
        this.trail.push({ ...control.position });
        this.trail = this.trail.slice(-12);
        if (!this.reduced.matches) {
          c.strokeStyle = control.pinching ? "#e1bdff60" : "#a4d7fb55";
          c.lineWidth = 2;
          c.beginPath();
          this.trail.forEach((point, i) => {
            const v = to(point);
            if (i) c.lineTo(v.x, v.y);
            else c.moveTo(v.x, v.y);
          });
          c.stroke();
        }
        c.strokeStyle = control.pinching ? "#e4c7ff" : "#d0c2ef";
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(p.x, p.y, control.pinching ? 10 : 6, 0, Math.PI * 2);
        c.stroke();
        if (world.held) {
          c.strokeStyle = "#dfc9ff66";
          c.setLineDash([3, 5]);
          c.beginPath();
          c.moveTo(p.x, p.y);
          const end = to({
            x: control.position.x + control.velocity.x * 0.24,
            y: control.position.y + control.velocity.y * 0.24,
          });
          c.lineTo(end.x, end.y);
          c.stroke();
          c.setLineDash([]);
        }
      } else this.trail = [];
    }
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const p = to(particle);
      c.globalAlpha = Math.max(0, Math.min(1, particle.life));
      c.fillStyle = particle.color;
      c.fillRect(p.x, p.y, particle.size, particle.size);
    }
    c.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const fx of this.effects) {
      fx.age += dt;
      const p = to(fx.position);
      const fade = Math.max(
        0,
        1 - fx.age / (fx.type === "phase" || fx.type === "domain" ? 3 : 1),
      );
      c.globalAlpha = fade;
      if (fx.type === "slash" && fx.to) {
        const end = to(fx.to);
        c.strokeStyle = "#f1d4ff";
        c.lineWidth = 4 * fade;
        c.shadowColor = "#c27bff";
        c.shadowBlur = 16;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(end.x, end.y);
        c.stroke();
        c.shadowBlur = 0;
      } else if (fx.type !== "phase" && fx.type !== "domain") {
        c.strokeStyle = fx.type === "hurt" ? "#ffb1a0" : "#c3efd9";
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(p.x, p.y, 15 + fx.age * 80, 0, Math.PI * 2);
        c.stroke();
      }
      if (fx.text && fx.type !== "phase" && fx.type !== "domain") {
        c.font = "bold 9px Manrope, sans-serif";
        c.textAlign = "center";
        c.fillStyle = "#e9d9ff";
        c.fillText(fx.text, p.x, p.y - 24 - fx.age * 20);
      }
      c.globalAlpha = 1;
    }
    this.effects = this.effects.filter(
      (f) => f.age < (f.type === "phase" || f.type === "domain" ? 3 : 1),
    );
    if (domain) {
      c.strokeStyle = "#d6c0ed55";
      c.lineWidth = 1;
      for (let i = 0; i < 9; i++) {
        const inset = i * 22 + (this.reduced.matches ? 0 : (t * 20) % 22);
        c.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
      }
    }
  }
}
