import type { Control } from "./control";

/** Each card needs a fresh gesture. Holding a palm cannot skip the next card. */
export class Preparation {
  step = 0;
  hold = 0;
  elapsed = 0;
  armed = true;
  private neutralMs = 0;
  get complete() {
    return this.step >= 3;
  }
  next() {
    this.step++;
    this.hold = this.elapsed = this.neutralMs = 0;
    this.armed = false;
  }
  pause() {
    this.hold = 0;
    this.armed = false;
    this.neutralMs = 0;
  }
  update(input: Control, dt: number) {
    if (this.complete) return false;
    this.elapsed += dt;
    if (!input.valid || !input.open) {
      this.hold = 0;
      this.neutralMs += dt;
      if (this.neutralMs >= 200) this.armed = true;
    } else {
      this.neutralMs = 0;
      if (this.armed && this.elapsed >= 1000) this.hold += dt;
      else this.hold = 0;
    }
    if (this.hold >= 600) {
      this.next();
      return true;
    }
    return false;
  }
}
export const preparationCards = [
  {
    title: "Дай магии пространство.",
    text: "Сядь чуть дальше от камеры. Обе кисти должны помещаться целиком — с запасом для небольших движений.",
    label: "01 / ПРОСТРАНСТВО",
    kind: "distance",
  },
  {
    title: "Выйди из тени.",
    text: "Пусть свет падает на руки спереди. Если за спиной яркое окно, повернись к нему лицом.",
    label: "02 / СВЕТ",
    kind: "light",
  },
  {
    title: "Расслабь руки.",
    text: "Опусти плечи и держи локти свободно. Не тянись к экрану. В бою будут передышки — в них можно полностью опустить руки.",
    label: "03 / КОМФОРТ",
    kind: "comfort",
  },
];
export function preparationArt(kind: string) {
  return `<svg viewBox="0 0 360 170" role="img" aria-label="${kind === "distance" ? "Человек отодвигается, руки помещаются в кадре" : kind === "light" ? "Источник света перемещается перед человеком" : "Плечи расслаблены, локти опущены"}">
    <defs><radialGradient id="prep-glow"><stop stop-color="#c7a0ff" stop-opacity=".2"/><stop offset="1" stop-color="#c7a0ff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="180" cy="100" rx="160" ry="70" fill="url(#prep-glow)"/>
    <path class="prep-frame" d="M78 55 V24 H110 M250 24 H282 V55 M78 128 V151 H110 M250 151 H282 V128"/>
    <g class="prep-person"><circle cx="180" cy="56" r="19"/><path d="M144 146 V110 Q144 83 180 83 Q216 83 216 110 V146"/><g class="prep-arms"><path d="M148 98 L126 127 L110 83 M212 98 L234 127 L250 83"/><path d="M110 83 V61 M104 80 V66 M116 80 V64 M250 83 V61 M244 80 V64 M256 80 V66"/></g></g>
    <g class="prep-sun"><circle cx="285" cy="53" r="14"/><path d="M285 28 V20 M285 78 V86 M260 53 H252 M310 53 H318 M267 35 L262 30 M303 71 L308 76 M267 71 L262 76 M303 35 L308 30"/></g>
    <path class="prep-direction" d="M155 157 H205 M155 157 L163 152 M155 157 L163 162 M205 157 L197 152 M205 157 L197 162"/>
  </svg>`;
}
