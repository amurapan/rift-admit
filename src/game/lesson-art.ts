import type { Lesson } from "../gestures";
const palm =
  '<path d="M58 116 L32 78 Q26 64 37 68 L56 88 V35 Q56 23 66 30 V66 V20 Q67 10 77 20 V65 V24 Q78 14 88 24 V68 V38 Q90 28 99 38 V88 Q117 61 120 78 L107 115 Q84 141 58 116Z"/>';
const sign =
  '<path d="M55 116 L43 83 Q41 72 53 74 L61 83 V26 Q61 14 72 24 V70 L86 23 Q92 13 99 24 L88 78 Q114 72 112 89 L106 116 Q81 140 55 116Z"/>';
const fist =
  '<path d="M45 108 V66 Q45 52 58 59 Q58 43 72 50 Q73 36 87 46 Q99 37 107 52 L113 85 L105 113 Q76 137 45 108Z M50 85 Q72 62 84 80 L64 103"/>';
export function lessonArt(lesson: Lesson) {
  const glyph =
    '<g class="ritual-glyph" transform="translate(245 75)"><circle r="38"/><circle r="27"/><path d="M0 -43 L37 22 L-37 22 Z M0 43 L37 -22 L-37 -22 Z"/></g>';
  const content =
    lesson === "vortex"
      ? `<g class="ritual-hand lesson-fist" transform="translate(20 0)">${fist}</g><g class="ritual-hand lesson-open" transform="translate(20 0)">${palm}</g>${glyph}<circle class="lesson-wave" cx="245" cy="75" r="42"/>`
      : lesson === "swipe"
        ? `<path class="lesson-cut" d="M35 75 L280 75"/><g transform="translate(30 0)"><g class="ritual-hand lesson-swing">${sign}</g></g><path class="ritual-glyph" d="M242 38 L272 75 L242 112 L212 75 Z"/>`
        : lesson === "shield"
          ? `<g class="ritual-hand" transform="translate(28 0)">${palm}</g><ellipse class="ritual-glyph" cx="128" cy="78" rx="36" ry="57"/><circle class="lesson-projectile" cx="265" cy="75" r="7"/>`
          : `<g class="ritual-hand" transform="translate(0 34) scale(.55)">${palm}</g><g class="ritual-hand" transform="translate(290 34) scale(-.55 .55)">${palm}</g><circle class="lesson-circle" cx="155" cy="75" r="42"/><path class="ritual-glyph lesson-open" d="M155 31 L193 97 L117 97 Z"/>`;
  return `<svg viewBox="0 0 320 150" role="img" aria-label="Последовательность движения для заклинания">${content}</svg>`;
}
