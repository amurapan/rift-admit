import { HandDetector, type Detection } from "./game/vision";
import { describeHand, type Hand, type Lesson } from "./gestures";
import { TutorialGate } from "./tutorial";
import { readBest, saveBest } from "./battle";
import {
  Arena,
  advice,
  BEAM_HOLD_MS,
  BOSS_HP,
  FINAL_PHASE_MS,
  type Advice,
} from "./game/arena";
import {
  Calibrator,
  DEFAULT_CALIBRATION,
  emptyControl,
  MotionControl,
  type Calibration,
} from "./game/control";
import { HandRouting, type HandPurpose } from "./game/hand-routing";
import { HandOverlay } from "./game/pointer";
import { Scene } from "./game/scene";
import { CursorFollower, TrackingContinuity } from "./game/tracking";
import {
  Preparation,
  preparationCards,
  preparationArt,
} from "./game/preparation";
import { lessonArt } from "./game/lesson-art";
import { Awakening } from "./game/ritual";
import { Sound } from "./game/audio";
import { icon } from "./icons";
import { MasteryGate } from "./game/mastery";
import { markup } from "./ui";
import "./style.css";
import "./battle.css";
import "./tutorial.css";
import "./arena.css";
import "./immersion.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = markup;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const text = (id: string, value: string) => {
  const node = el(id).querySelector<HTMLElement>("[data-label]") ?? el(id);
  if (node.textContent !== value) node.textContent = value;
};
const video = el<HTMLVideoElement>("camera");
const skeleton = el<HTMLCanvasElement>("skeleton");
const sk = skeleton.getContext("2d")!;
const scene = new Scene(el<HTMLCanvasElement>("scene"));
const sound = new Sound();
const motion = new MotionControl();
const tutorial = new TutorialGate();
const lessons: Lesson[] = ["vortex", "shield", "swipe", "domain"];
const names = [
  "СЖАТИЕ ПРОСТРАНСТВА",
  "ОТРАЖЕНИЕ",
  "РАЗРЕЗ РЕАЛЬНОСТИ",
  "ТЕРРИТОРИЯ",
];
let mode:
  | "idle"
  | "loading"
  | "preparation"
  | "awakening"
  | "calibration"
  | "demo"
  | "practice"
  | "mastery"
  | "ready"
  | "battle"
  | "result" = "idle";
let preparation = new Preparation();
let preparationResume: (() => void) | null = null;
let preparationSeen = false;
try {
  preparationSeen = localStorage.getItem("rift.preparation.seen") === "yes";
} catch {}
let awakening = new Awakening();
let awakeningDoneAt = 0;
let trained = false;
try {
  trained = localStorage.getItem("rift.ritual.trained") === "yes";
} catch {}
let model: HandDetector | null = null;
let detectorLoading: AbortController | null = null;
let stream: MediaStream | null = null;
let generation = 0;
let lastHud = 0;
let lastInference = 0,
  lastFrame = performance.now();
let world: Arena | null = null;
let control = emptyControl();
let hand: Hand | null = null;
const castingHand = new HandRouting();
const cursors = new CursorFollower();
const continuity = new TrackingContinuity();
const handOverlay = new HandOverlay();
let calibrator = new Calibrator();
let calibration: Calibration = { ...DEFAULT_CALIBRATION };
let practiceList = [...lessons],
  lessonIndex = 0;
let mastery = new MasteryGate();
let masteryRevealAt = 0;
let masteryBattle = false;
let acceptedLevel = 0;
let resultArmed = false,
  resultHold = 0,
  resultGesture = "";
let bestScore = 0;
let runs: { score: number; won: boolean; hits: number; combo: number }[] = [];
let recommendation: Advice | null = null;
let cinematicUntil = 0;
let pendingHint = "",
  hintAt = 0;
try {
  bestScore = readBest(localStorage);
  const saved = JSON.parse(localStorage.getItem("rift.runs.v3") ?? "[]");
  if (Array.isArray(saved))
    runs = saved
      .filter(
        (r) =>
          Number.isFinite(r.score) &&
          Number.isFinite(r.combo) &&
          Number.isFinite(r.hits) &&
          typeof r.won === "boolean",
      )
      .slice(-8);
} catch {
  /* Private browsing can disable storage. */
}
function history() {
  text("best-score", bestScore.toLocaleString("ru-RU"));
  text(
    "history",
    runs.length
      ? `Последние бои: ${runs.length} · Победы: ${runs.filter((r) => r.won).length} · Лучшая серия: ${Math.max(...runs.map((r) => r.combo))}`
      : "Первый разлом ещё впереди.",
  );
}
document.querySelectorAll<HTMLElement>("[data-art]").forEach((node) => {
  node.innerHTML = lessonArt(node.dataset.art as "spear" | "bind");
});
document.querySelectorAll<HTMLElement>(".spell").forEach((node, i) => {
  const art = document.createElement("div");
  art.className = "spell-reference";
  art.innerHTML = lessonArt(lessons[i]);
  node.append(art);
});
history();

function hidePanels() {
  document.body.classList.remove("help-open", "preparing", "mastering");
  el("help").setAttribute("aria-expanded", "false");
  for (const id of [
    "awakening",
    "preparation",
    "mastery",
    "rest-panel",
    "start-panel",
    "calibration",
    "lesson-demo",
    "result",
    "feedback",
    "battle-hud",
    "countdown",
    "cinematic",
    "battle-message",
    "portal-caption",
  ])
    el(id).hidden = true;
}
function hint(message: string, now: number, immediate = false) {
  if (message !== pendingHint) {
    pendingHint = message;
    hintAt = now;
  }
  if (immediate || now - hintAt > 170) text("hint", message);
}
function spellbook(active = -1) {
  document.querySelectorAll<HTMLElement>(".spell").forEach((spell, i) => {
    spell.classList.toggle("active", i === active);
    spell.classList.toggle(
      "done",
      mode === "ready" ||
        mode === "result" ||
        ((mode === "demo" || mode === "practice") &&
          practiceList.length === 4 &&
          i < lessonIndex),
    );
    spell.querySelector(".spell-check")!.innerHTML = spell.classList.contains(
      "done",
    )
      ? icon("check")
      : "";
  });
}
function clearMotion(invalidateDetection = true) {
  if (invalidateDetection) model?.invalidate();
  cursors.reset();
  continuity.reset();
  handOverlay.reset();
  motion.reset();
  control = emptyControl();
  castingHand.reset();
  resultHold = 0;
}
function beginCalibration() {
  if (!model) return;
  mode = "calibration";
  calibrator = new Calibrator();
  world = null;
  clearMotion();
  hidePanels();
  el("calibration").hidden = false;
  text("arena-status", "КАЛИБРОВКА");
  text("counter", "КОМФОРТНЫЙ РАЗМАХ");
  text(
    "calibration-hint",
    "Раскрой ладонь. Проведи ею влево, вправо, вверх и вниз — насколько тебе удобно.",
  );
  el("calibration-progress").style.width = "0%";
  spellbook();
}
function finishCalibration(useDefault = false) {
  calibration = useDefault ? { ...DEFAULT_CALIBRATION } : calibrator.finish();
  beginTraining();
}
function beginTraining(single?: Lesson) {
  practiceList = single ? [single] : [...lessons];
  lessonIndex = 0;
  introduceLesson();
}
function introduceLesson() {
  const lesson = practiceList[lessonIndex],
    index = lessons.indexOf(lesson);
  mode = "demo";
  masteryRevealAt = 0;
  world = new Arena(lesson);
  tutorial.reset();
  clearMotion();
  hidePanels();
  world.tick(1, { ...emptyControl(), valid: true });
  el("lesson-demo").hidden = false;
  text(
    "arena-status",
    practiceList.length === 1 ? "ЛИЧНАЯ ТРЕНИРОВКА" : "ПРОБУЖДЕНИЕ СИЛЫ",
  );
  text("counter", `${lessonIndex + 1} / ${practiceList.length}`);
  text(
    "lesson-number",
    [
      "ОБЛОМКИ ПЕРЕКРЫЛИ ПУТЬ",
      "ОН ПОСЛАЛ ПЕРВУЮ АТАКУ",
      "РАССЕКИ ЕГО ОКОВЫ",
      "ТЕПЕРЬ ЭТО ТВОЁ ПРОСТРАНСТВО",
    ][index],
  );
  text(
    "lesson-title",
    [
      "Сожми пространство.",
      "Отрази его силу.",
      "Оставь трещину в реальности.",
      "Раскрой свою территорию.",
    ][index],
  );
  text(
    "lesson-instruction",
    [
      "Покажи ладонь, затем сожми кулак рядом с обломками. Дождись яркого кольца и полностью раскрой ладонь — выпусти волну.",
      "Поставь открытую ладонь на светящуюся траекторию снаряда. Печать примет удар. Подними её перед попаданием, чтобы отразить атаку.",
      "Любая рука: подними УКАЗАТЕЛЬНЫЙ и СРЕДНИЙ. Согни безымянный и мизинец. Дождись свечения её курсора, затем взмахни через кристалл.",
      "Подними указательный и средний на каждой руке. Удержи до свечения, затем раскрой обе ладони. Кисти не должны перекрывать друг друга.",
    ][index],
  );
  el("lesson-animation").innerHTML = lessonArt(lesson);
  el("lesson-demo").dataset.phase = "demo";
  text("lesson-arm", "Посмотри движение · 3");
  el("lesson-arm-progress").style.width = "0%";
  text("spell-name", names[index]);
  spellbook(index);
}
function revealMastery(battle = false) {
  if (!world) return;
  masteryBattle = battle;
  const technique = battle
    ? world.phase === 1
      ? "spear"
      : "bind"
    : world.practice!;
  const number = battle
    ? world.phase + 4
    : lessons.indexOf(technique as Lesson) + 1;
  const title = battle
    ? technique === "spear"
      ? "Копьё разлома"
      : "Печать оков"
    : names[lessons.indexOf(technique as Lesson)];
  mode = "mastery";
  mastery = new MasteryGate();
  world.magic.reset();
  world.paused = true;
  clearMotion();
  hidePanels();
  document.body.classList.add("mastering");
  el("mastery").hidden = false;
  el("mastery").focus();
  el("mastery").dataset.armed = "false";
  el("mastery").dataset.technique = technique;
  text("mastery-kicker", battle ? "НОВАЯ ТЕХНИКА" : "ТЕХНИКА ОСВОЕНА");
  text("mastery-number", `ПЕЧАТЬ / ${String(number).padStart(2, "0")}`);
  text("mastery-title", title);
  el("mastery-art").innerHTML = lessonArt(technique);
  el("mastery-emblem-icon").innerHTML = icon(
    (
      {
        vortex: "rift",
        shield: "shield",
        swipe: "slash",
        domain: "seal",
        spear: "arrow",
        bind: "seal",
      } as const
    )[technique],
  );
  text(
    "mastery-description",
    battle
      ? technique === "spear"
        ? "Указательный и большой раскрыты, остальные согнуты. Наведи на цель и удержи 0,6 с — копьё пробьёт броню."
        : "Кулак и раскрытая ладонь рядом, без перекрытия. Удержи 0,65 с — снаряды замрут на 3 секунды."
      : "Печать отвечает тебе. Забери её силу и продолжи свой путь.",
  );
  text("mastery-hint", "Сожми кулак, затем раскрой ладонь для подтверждения.");
  el("mastery-progress").style.width = "0%";
  sound.discovery();
}
function confirmMastery() {
  clearMotion();
  hidePanels();
  if (masteryBattle && world) {
    acceptedLevel = world.phase;
    mode = "battle";
    el("battle-hud").hidden = false;
    el("feedback").hidden = false;
    updateHud(performance.now());
  } else {
    lessonIndex++;
    if (lessonIndex < practiceList.length) introduceLesson();
    else ready();
  }
}
// This screen has no timer or button that can accidentally skip a technique.
el("mastery").addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    if (document.activeElement === el("stop")) el("mastery").focus();
    else el("stop").focus();
  }
});
function startPractice() {
  mode = "practice";
  el("lesson-demo").hidden = true;
  el("feedback").hidden = false;
  clearMotion();
  text("progress-label", "ПОПРОБУЙ");
  el("progress-fill").style.width = "0%";
  hint(
    [
      "Покажи ладонь, затем удержи кулак рядом с обломками и раскрой его.",
      "Останови снаряд щитом: раскрой ладонь на пунктирной траектории",
      "Удержи указательный и средний пальцы, затем проведи разрез через кристалл.",
      "два пальца на каждой руке. Удержи печать, затем раскрой обе ладони.",
    ][lessons.indexOf(practiceList[lessonIndex])],
    performance.now(),
    true,
  );
}
function ready() {
  trained = true;
  try {
    localStorage.setItem("rift.ritual.trained", "yes");
  } catch {}
  mode = "ready";
  world = null;
  clearMotion();
  hidePanels();
  resultArmed = false;
  resultGesture = "";
  recommendation = null;
  el("result").hidden = false;
  el("report").hidden = true;
  el("retrain").hidden = false;
  el("result").classList.remove("defeat");
  text("arena-status", "ТЫ ГОТОВ");
  text("counter", "ДАЛЬШЕ — СВОБОДНЫЙ БОЙ");
  el("result-mark").innerHTML = icon("rift");
  text("result-eyebrow", "МАГИЯ ПОДЧИНЯЕТСЯ ТЕБЕ");
  text("result-title", "Теперь удержи тьму.");
  text(
    "result-description",
    "Три фазы. Живое ядро. Один противник по ту сторону. Выбирай способности сам.",
  );
  text("result-value", "1:05");
  text("result-value-label", "НА ЗАКРЫТИЕ РАЗЛОМА");
  text("duration", "100%");
  text("duration-label", "ПРОЧНОСТЬ ЯДРА");
  text("restart", "Войти в разлом");
  text(
    "restart-hint",
    "Убери руку из кадра, затем удерживай открытую ладонь 1,5 секунды.",
  );
  el("restart-progress").style.width = "0%";
  spellbook();
}
function startBattle() {
  if (!model) return;
  mode = "battle";
  world = new Arena();
  acceptedLevel = 0;
  clearMotion();
  hidePanels();
  el("battle-hud").hidden = false;
  el("feedback").hidden = false;
  el("countdown").hidden = false;
  document.body.classList.add("arena-mode");
  text("arena-status", "ЗАЩИТИ ЯДРО");
  text("counter", "I · ПЕРВЫЕ ТРЕЩИНЫ");
  text("spell-name", "СВОБОДНЫЙ БОЙ");
  spellbook();
  hint(
    "Сохрани ядро до пробуждения босса, затем уничтожь его глаз. Луч отражай ладонью в отмеченном кольце.",
    performance.now(),
    true,
  );
}
function showResult() {
  if (!world || mode !== "battle") return;
  const won = world.status === "victory";
  recommendation = advice(world.stats);
  const record = world.score > bestScore;
  bestScore = Math.max(bestScore, world.score);
  runs.push({
    score: world.score,
    won,
    hits: world.stats.damage,
    combo: world.maxCombo,
  });
  runs = runs.slice(-8);
  try {
    saveBest(localStorage, bestScore);
    localStorage.setItem("rift.runs.v3", JSON.stringify(runs));
  } catch {
    /* Keep progress for this session. */
  }
  history();
  mode = "result";
  hidePanels();
  resultArmed = false;
  resultHold = 0;
  resultGesture = "";
  el("result").hidden = false;
  el("report").hidden = false;
  el("retrain").hidden = true;
  el("result").classList.toggle("defeat", !won);
  text("arena-status", won ? "РАЗЛОМ ЗАКРЫТ" : "БОЙ ЗАВЕРШЁН");
  el("result-mark").innerHTML = icon(won ? "rift" : "seal");
  text(
    "result-eyebrow",
    won ? "ПОБЕДА · РАЗЛОМ ЗАКРЫТ" : "ПОРАЖЕНИЕ · ЕЩЁ ОДНА ПОПЫТКА",
  );
  text("result-title", won ? "Тьма отступила." : "Ты ещё вернёшься.");
  text(
    "result-description",
    won
      ? "Ядро уцелело. По ту сторону стало тихо."
      : world.health <= 0
        ? "Ядро не выдержало атак. Посмотри, что можно улучшить."
        : "Время вышло. В последней фазе атакуй открытый глаз и возвращай его снаряды.",
  );
  text("result-value", world.score.toLocaleString("ru-RU"));
  text("result-value-label", record ? "НОВЫЙ РЕКОРД" : "ОЧКИ");
  text("duration", `×${world.maxCombo}`);
  text("duration-label", "ЛУЧШАЯ СЕРИЯ");
  text(
    "result-detail",
    `Копья: ${world.stats.spearHits}/${world.stats.spears} · Оковы: ${world.stats.binds} · Волны в цель: ${world.stats.burstHits}/${world.stats.bursts} · Отражения: ${world.stats.parries} · Лучи: ${world.stats.beamsReflected}/${world.stats.beamsReflected + world.stats.beamsMissed} · Разрезы: ${world.stats.cutHits}/${world.stats.cuts} · Территории: ${world.stats.domains}`,
  );
  text("advice-title", recommendation.title);
  text("advice-detail", recommendation.detail);
  text("restart", "Ещё один разлом");
  text(
    "restart-hint",
    "Убери руку. Ладонь — новый бой, кулак — тренировка по совету.",
  );
  el("restart-progress").style.width = "0%";
  spellbook();
}

function shutdown(message = "Камера выключена. Можно начать снова.") {
  generation++;
  detectorLoading?.abort();
  detectorLoading = null;
  mode = "idle";
  world = null;
  clearMotion();
  hand = null;
  stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
  stream = null;
  video.srcObject = null;
  model?.close();
  model = null;
  hidePanels();
  sound.suspend();
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  document.body.classList.remove("camera-on", "arena-mode");
  el("start-panel").hidden = false;
  el("portal-caption").hidden = false;
  el("camera-placeholder").hidden = false;
  el("stop").hidden = true;
  el("recalibrate").hidden = true;
  const start = el<HTMLButtonElement>("start");
  start.disabled = false;
  text("start", "Войти в разлом");
  text("setup-note", message);
  text("camera-badge", "КАМЕРА ВЫКЛ.");
  text("arena-status", "ОЖИДАНИЕ МАГА");
  text("tracking-status", "СВЯЗЬ НЕ УСТАНОВЛЕНА");
  spellbook();
}
el("start").addEventListener("click", async () => {
  const token = ++generation;
  mode = "loading";
  el<HTMLButtonElement>("start").disabled = true;
  text("start", "Подключаем камеру…");
  text("setup-note", "Разреши доступ в окне браузера.");
  void sound.unlock();
  void enterFullscreen();
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Для камеры открой сайт через HTTPS или localhost.");
    const acquired = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    if (token !== generation) {
      acquired.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquired;
    video.srcObject = acquired;
    await video.play();
    if (token !== generation) return;
    el("stop").hidden = false;
    el("camera-placeholder").hidden = true;
    text("camera-badge", "ПОДКЛЮЧЕНА");
    text("start", "Пробуждаем магию…");
    text(
      "setup-note",
      "Загружается распознавание. Кадры остаются на устройстве.",
    );
    detectorLoading = new AbortController();
    const loaded = await HandDetector.create(
      acceptDetection,
      (error) => {
        if (token !== generation) return;
        console.error(error);
        shutdown("Распознавание остановилось. Включи камеру снова.");
      },
      detectorLoading.signal,
    );
    if (token !== generation) {
      loaded.close();
      return;
    }
    model = loaded;
    model.start(video);
    stream!.getVideoTracks()[0].onended = () =>
      shutdown("Камера отключилась. Подключи её и начни снова.");
    lastInference = 0;
    el("recalibrate").hidden = false;
    document.body.classList.add("camera-on");
    hidePanels();
    beginPreparation();
  } catch (error) {
    if (token !== generation) return;
    const name = error instanceof Error ? error.name : "";
    const message =
      name === "NotAllowedError"
        ? "Разреши доступ к камере в настройках сайта и попробуй снова."
        : name === "NotFoundError"
          ? "Камера не найдена. Подключи веб-камеру."
          : name === "NotReadableError"
            ? "Камера занята. Закрой приложение, которое её использует."
            : error instanceof Error && error.message.startsWith("Для камеры")
              ? error.message
              : "Не удалось загрузить распознавание. Проверь подключение и попробуй снова.";
    console.error(error);
    shutdown(message);
  }
});
async function enterFullscreen() {
  if (
    !document.fullscreenElement &&
    document.documentElement.requestFullscreen
  ) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* The viewport remains immersive when fullscreen is unavailable. */
    }
  }
}
el("fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void enterFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  text("fullscreen", document.fullscreenElement ? "В окно" : "На весь экран");
});
function renderPreparation() {
  if (preparation.complete) {
    finishPreparation();
    return;
  }
  const card = preparationCards[preparation.step];
  text("preparation-number", card.label);
  text("preparation-title", card.title);
  text("preparation-description", card.text);
  el("preparation").dataset.step = String(preparation.step);
  el("preparation-art").dataset.kind = card.kind;
  el("preparation-art").innerHTML = preparationArt(card.kind);
  el("preparation-progress").style.width = "0%";
  el("preparation-next").focus();
}
function beginPreparation(replay = false) {
  if (!model) return;
  const previousMode = mode;
  preparationResume = replay
    ? () => {
        mode = previousMode;
      }
    : null;
  document.body.classList.remove("help-open");
  el("help").setAttribute("aria-expanded", "false");
  world?.magic.pause();
  mode = "preparation";
  preparation = new Preparation();
  clearMotion();
  el("preparation").hidden = false;
  document.body.classList.add("preparing");
  el("preparation-skip").hidden = !preparationSeen;
  renderPreparation();
}
function finishPreparation() {
  el("preparation").hidden = true;
  document.body.classList.remove("preparing");
  preparationSeen = true;
  try {
    localStorage.setItem("rift.preparation.seen", "yes");
  } catch {}
  clearMotion();
  if (preparationResume) {
    const resume = preparationResume;
    preparationResume = null;
    resume();
  } else beginAwakening();
}
el("preparation-next").addEventListener("click", () => {
  preparation.next();
  renderPreparation();
});
el("preparation-skip").addEventListener("click", finishPreparation);
el("show-preparation").addEventListener("click", () => beginPreparation(true));
el("preparation").addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const buttons = [
    ...el("preparation").querySelectorAll<HTMLButtonElement>("button"),
  ].filter((b) => !b.hidden);
  if (event.shiftKey && document.activeElement === buttons[0]) {
    event.preventDefault();
    buttons.at(-1)?.focus();
  }
  if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
    event.preventDefault();
    buttons[0].focus();
  }
});
function beginAwakening() {
  mode = "awakening";
  awakening = new Awakening();
  awakeningDoneAt = 0;
  clearMotion();
  hidePanels();
  el("awakening").hidden = false;
  el("skip-intro").hidden = true;
  el("skip-training").hidden = !trained;
  text("arena-status", "ПО ТУ СТОРОНУ");
  text("counter", "ПРОБУЖДЕНИЕ");
  sound.effect({ type: "phase", position: { x: 0.5, y: 0.2 } });
}
el("skip-intro").addEventListener("click", () => beginTraining());
el("skip-training").addEventListener("click", () => {
  if (trained) startBattle();
});
el("help").addEventListener("click", () => {
  if (mode === "preparation" || mode === "mastery") return;
  const open = document.body.classList.toggle("help-open");
  el("help").setAttribute("aria-expanded", String(open));
  clearMotion();
});
document
  .querySelectorAll<HTMLButtonElement>("[data-practice]")
  .forEach((button) => {
    button.addEventListener("click", () => {
      if (model) beginTraining(button.dataset.practice as Lesson);
    });
  });
el("stop").addEventListener("click", () => shutdown());
el("default-calibration").addEventListener("click", () =>
  finishCalibration(true),
);
el("recalibrate").addEventListener("click", beginCalibration);
el("restart").addEventListener("click", startBattle);
el("retrain").addEventListener("click", () => beginTraining());
el("drill").addEventListener("click", () =>
  beginTraining(recommendation?.lesson),
);
el("sound").addEventListener("click", () => {
  sound.toggle();
  text("sound", sound.enabled ? "ЗВУК ВКЛ." : "ЗВУК ВЫКЛ.");
  el("sound").setAttribute("aria-pressed", String(sound.enabled));
});
window.addEventListener("pagehide", () => shutdown());
document.addEventListener("visibilitychange", () => {
  clearMotion();
  hand = null;
  tutorial.pause();
  preparation.pause();
  mastery.pause();
  world?.magic.pause();
  awakening.hold = 0;
  awakening.armed = false;
  calibrator.fistMs = 0;
  lastFrame = performance.now();
  if (document.hidden) sound.suspend();
  else if (model) void sound.unlock();
});
const connections = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [5, 9, 10, 11, 12],
  [9, 13, 14, 15, 16],
  [13, 17, 18, 19, 20],
  [0, 17],
];
function acceptDetection(detected: Detection) {
  if (document.hidden) return;
  const now = detected.timestamp;
  const dt = Math.min(100, now - lastInference);
  lastInference = now;
  const { landmarks, sides, width, height } = detected;
  const hands = landmarks.map((points) => describeHand(points, width / height));
  const purpose: HandPurpose =
    mode === "demo" || mode === "mastery"
      ? "fist"
      : mode === "preparation" || mode === "ready"
        ? "open"
        : mode === "calibration"
          ? calibrator.ready
            ? "fist"
            : "open"
          : mode === "practice"
            ? world?.practice === "shield"
              ? "open"
              : world?.practice === "domain"
                ? "any"
                : (world!.practice as "vortex" | "swipe")
            : mode === "battle"
              ? "battle"
              : "any";
  const locked =
    mode === "mastery"
      ? mastery.armed || mastery.hold > 0
      : mode === "demo"
        ? tutorial.fistMs > 0
        : mode === "preparation"
          ? preparation.hold > 0
          : mode === "calibration"
            ? calibrator.fistMs > 0
            : mode === "ready" || mode === "result"
              ? resultHold > 0
              : mode === "battle" || mode === "practice"
                ? !!world?.magic.ownsHand
                : false;
  const index = castingHand.choose(
    hands,
    sides,
    now,
    purpose,
    locked,
    (world?.phase ?? 0) >= 1,
  );
  if (castingHand.switched) {
    // Never carry a motion path, confirmation or charge into another hand.
    motion.reset();
    continuity.reset();
    cursors.reset();
    handOverlay.reset();
    world?.magic.pause();
    tutorial.pause();
    mastery.pause();
    preparation.pause();
    resultHold = 0;
    calibrator.fistMs = 0;
    if (
      (mode === "battle" || mode === "practice") &&
      castingHand.primed &&
      hands[index]?.extended === 0
    )
      world?.magic.primeCompression();
  }
  hand = index < 0 ? null : (hands[index] ?? null);
  control = continuity.update(
    motion.update(
      hand,
      index < 0 ? null : (hands[1 - index] ?? null),
      now,
      calibration,
    ),
    performance.now(),
  );
  control.handId = castingHand.id;
  cursors.sample(control, now);
  if (!control.trackingGrace)
    handOverlay.sample(
      index < 0
        ? []
        : [
            landmarks[index],
            ...(landmarks[1 - index] ? [landmarks[1 - index]] : []),
          ],
      now,
    );
  if (!control.trackingGrace)
    text(
      "tracking-status",
      hand ? (hand.quality ?? "РУКА РАСПОЗНАНА") : "ПОКАЖИ РУКУ В КАДРЕ",
    );
  if (document.body.classList.contains("help-open")) return true;
  if (mode === "mastery") {
    const confirmed = mastery.update(control, dt);
    el("mastery").dataset.armed = String(mastery.armed);
    text(
      "mastery-hint",
      control.quality ??
        (!control.valid
          ? "Покажи кисть целиком. Сожми кулак, затем раскрой ладонь."
          : mastery.armed
            ? "Теперь раскрой ладонь и удержи — забери силу печати."
            : "Сожми кулак, затем раскрой ладонь для подтверждения."),
    );
    el("mastery-progress").style.width = `${mastery.hold / 6.5}%`;
    if (confirmed) confirmMastery();
  } else if (mode === "preparation") {
    if (preparation.update(control, dt)) renderPreparation();
    if (mode === "preparation") {
      text(
        "preparation-hint",
        !preparation.armed
          ? "Опусти или закрой ладонь перед следующей карточкой"
          : (control.quality ??
              (!control.valid
                ? "Покажи ладонь целиком — или продолжи кнопкой"
                : "Раскрой ладонь и удержи, чтобы продолжить")),
      );
      el("preparation-progress").style.width = `${preparation.hold / 6}%`;
    }
  } else if (mode === "awakening") {
    awakening.update(control, dt);
    text("awakening-hint", awakening.hint);
    text(
      "awakening-title",
      awakening.armed
        ? "Разорви завесу."
        : awakening.elapsed < 4200
          ? "Он уже здесь."
          : "Сложи первую печать.",
    );
    el("awakening").dataset.stage = awakening.armed ? "spread" : "sign";
    el("awakening-progress").style.width =
      `${Math.min(100, awakening.armed ? awakening.spread * 100 : awakening.hold / 6.5)}%`;
    el("skip-intro").hidden = awakening.elapsed < 4200;
    if (awakening.complete && !awakeningDoneAt) {
      awakeningDoneAt = now + 1400;
      scene.emit([{ type: "burst", position: { x: 0.5, y: 0.4 }, power: 1 }]);
      sound.effect({ type: "domain", position: { x: 0.5, y: 0.4 } });
    }
    if (awakeningDoneAt && now >= awakeningDoneAt) beginTraining();
  } else if (mode === "calibration") {
    calibrator.update(hand, dt);
    const p = hand?.palm ?? { x: 0.5, y: 0.5 },
      b = calibrator.bounds;
    el("calibration-cursor").style.left = `${p.x * 100}%`;
    el("calibration-cursor").style.top = `${p.y * 100}%`;
    Object.assign(el("calibration-range").style, {
      left: `${b.minX * 100}%`,
      top: `${b.minY * 100}%`,
      width: `${Math.max(0, b.maxX - b.minX) * 100}%`,
      height: `${Math.max(0, b.maxY - b.minY) * 100}%`,
    });
    el("calibration").classList.toggle("calibrated", calibrator.ready);
    text(
      "calibration-hint",
      hand?.quality ??
        (!hand
          ? "Покажи раскрытую ладонь целиком перед камерой"
          : calibrator.ready
            ? "Размах запомнен. Сожми кулак, чтобы начать обучение."
            : b.maxX - b.minX < 0.2
              ? "Медленно проведи открытую ладонь влево и вправо"
              : "Теперь проведи ладонь вверх и вниз в удобном диапазоне"),
    );
    el("calibration-progress").style.width =
      `${(calibrator.fistMs / 500) * 100}%`;
    if (calibrator.fistMs >= 500) finishCalibration();
  } else if (mode === "demo") {
    const ready = tutorial.update(hand, now);
    el("lesson-demo").dataset.phase = tutorial.phase;
    text(
      "lesson-arm",
      tutorial.phase === "demo"
        ? `Посмотри движение · ${Math.max(1, Math.ceil(tutorial.remainingMs / 1000))}`
        : (hand?.quality ??
            "Сожми кулак любой рукой на полсекунды, когда будешь готов"),
    );
    el("lesson-arm-progress").style.width = `${(tutorial.fistMs / 400) * 100}%`;
    if (ready) startPractice();
  } else if (mode === "ready" || mode === "result") {
    if (!hand) resultArmed = true;
    const gesture = hand?.open
      ? "open"
      : hand && hand.extended === 0 && mode === "result"
        ? "fist"
        : "";
    if (gesture !== resultGesture) {
      resultHold = 0;
      resultGesture = gesture;
    }
    resultHold =
      resultArmed && gesture && hand && !hand.quality ? resultHold + dt : 0;
    if (resultArmed)
      text(
        "restart-hint",
        mode === "result"
          ? "Ладонь — ещё бой. Кулак — тренировка по совету. Удерживай 1,5 секунды."
          : "Удерживай открытую ладонь 1,5 секунды для старта.",
      );
    el("restart-progress").style.width =
      `${Math.min(100, (resultHold / 1500) * 100)}%`;
    if (resultHold >= 1500) {
      if (gesture === "fist") beginTraining(recommendation?.lesson);
      else startBattle();
    }
  }
  return true;
}
function drawHandOverlay(now: number) {
  if (!video.videoWidth || !video.videoHeight) return;
  // The camera preview is only ~126px wide. Do not repaint a full VGA overlay
  // at display refresh rate just to downscale it again during compositing.
  const width = Math.min(256, video.videoWidth);
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  if (skeleton.width !== width || skeleton.height !== height) {
    skeleton.width = width;
    skeleton.height = height;
  }
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  handOverlay.draw(now).forEach((points, i) => {
    sk.strokeStyle =
      (i === 0 ? castingHand.id : 1 - castingHand.id) === 0
        ? "#e1c1ff"
        : "#b4efd9";
    sk.fillStyle = sk.strokeStyle;
    sk.lineWidth = 1;
    connections.forEach((chain) => {
      sk.beginPath();
      chain.forEach((n, j) => {
        const p = points[n];
        if (j) sk.lineTo(p.x * skeleton.width, p.y * skeleton.height);
        else sk.moveTo(p.x * skeleton.width, p.y * skeleton.height);
      });
      sk.stroke();
    });
    points.forEach((p) => {
      sk.beginPath();
      sk.arc(p.x * skeleton.width, p.y * skeleton.height, 1, 0, Math.PI * 2);
      sk.fill();
    });
  });
}
function updateHud(now: number) {
  if (!world) return;
  if (mode === "practice" && world.practiceDone) {
    hint("Печать принята. Сила подчинилась тебе.", now, true);
    return;
  }
  if (mode === "battle") {
    const seconds = Math.ceil(world.remainingMs / 1000);
    text(
      "time-left",
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    );
    text("health", `${world.health}%`);
    text("score", world.score.toLocaleString("ru-RU"));
    text("combo", `×${world.combo}`);
    text(
      "counter",
      ["I · ПЕРВЫЕ ТРЕЩИНЫ", "II · ВТОРЖЕНИЕ", "III · ПРОБУЖДЕНИЕ"][
        world.phase
      ],
    );
    text("boss-name", world.phase === 2 ? "НАБЛЮДАТЕЛЬ" : "ЗАВЕСА");
    const attackWindow = world.attackWindowMs;
    el("battle-hud").classList.toggle(
      "boss-exposed",
      attackWindow > 0 && world.beam?.stage !== "charging",
    );
    text(
      "boss-state",
      world.beam?.stage === "charging"
        ? `ЛУЧ ЧЕРЕЗ ${Math.ceil(world.beam.remaining / 1000)} С`
        : world.beam?.stage === "reflected"
          ? "ЛУЧ ВОЗВРАЩЁН"
          : world.phase === 2
            ? attackWindow > 0
              ? `АТАКУЙ ГЛАЗ · ${(attackWindow / 1000).toFixed(1)} С`
              : "ГОТОВИТ ЗАЛП"
            : `ДО ПРОБУЖДЕНИЯ · ${Math.ceil(Math.max(0, FINAL_PHASE_MS - world.elapsed) / 1000)} С`,
    );
    el("boss-fill").style.width =
      `${world.phase === 2 ? (world.bossHp / BOSS_HP) * 100 : 100 - (world.elapsed / FINAL_PHASE_MS) * 100}%`;
    text("shield-value", `${Math.round(world.shieldEnergy)}%`);
    text(
      "energy-value",
      world.energy >= 100 ? "ГОТОВА" : `${Math.round(world.energy)}%`,
    );
    el("energy-value").classList.toggle("ready-energy", world.energy >= 100);
    el("countdown").hidden = world.status !== "countdown";
    text(
      "countdown-number",
      control.valid || control.trackingGrace
        ? String(Math.max(1, Math.ceil(world.countdownMs / 1000)))
        : "БОЙ",
    );
    el("battle-message").hidden =
      world.restMs > 0 || control.valid || !!control.trackingGrace;
    el("rest-panel").hidden = world.restMs <= 0;
    text("rest-countdown", String(Math.ceil(world.restMs / 1000)));
    text(
      "rest-unlock",
      world.phase === 1
        ? "Открыто копьё: указательный + большой → наведи на цель"
        : "Оковы: кулак + ладонь рядом → снаряды замрут",
    );
    const restArt = world.phase === 1 ? "spear" : "bind";
    if (el("rest-art").dataset.spell !== restArt) {
      el("rest-art").dataset.spell = restArt;
      el("rest-art").innerHTML = lessonArt(restArt);
    }
    text(
      "extra-status",
      world.phase >= 1
        ? `КОПЬЁ ${world.magic.spearCooldown > 0 ? Math.ceil(world.magic.spearCooldown / 1000) + " с" : "ГОТОВО"}${world.phase >= 2 ? " · ОКОВЫ " + (world.magic.bindCooldown > 0 ? Math.ceil(world.magic.bindCooldown / 1000) + " с" : "ГОТОВЫ") : " · ЖЕСТЫ В СПРАВОЧНИКЕ"}`
        : "ДОПОЛНИТЕЛЬНЫЕ ПЕЧАТИ ОТКРОЮТСЯ В БОЮ",
    );
    el("rest-panel").dataset.technique = world.phase === 1 ? "spear" : "bind";
    document.querySelectorAll<HTMLElement>("[data-extra]").forEach((card) => {
      const unlocked =
        acceptedLevel >= (card.dataset.extra === "spear" ? 1 : 2);
      card.classList.toggle("unlocked", unlocked);
      card.querySelector(".eyebrow")!.textContent = unlocked
        ? "ТЕХНИКА ДОСТУПНА"
        : "ОТКРОЕТСЯ ПО ХОДУ БОЯ";
    });
    text("battle-message", "Пауза · верни руку целиком в кадр");
    text(
      "spell-name",
      world.magic.label
        ? world.magic.label
        : world.shieldActive
          ? "ЩИТ АКТИВЕН"
          : world.phase === 1
            ? "КОПЬЁ ДОСТУПНО · СМОТРИ ПЕЧАТИ"
            : "СВОБОДНЫЙ БОЙ",
    );
    text(
      "progress-label",
      world.magic.domainHold > 0
        ? "РАСШИРЕНИЕ…"
        : world.domainMs > 0
          ? "ВРЕМЯ ЗАМЕДЛЕНО"
          : world.combo > 2
            ? `СЕРИЯ ×${world.combo}`
            : "ВЫБИРАЙ СПОСОБНОСТЬ",
    );
    el("progress-fill").style.width =
      `${world.magic.progress ? world.magic.progress * 100 : world.shieldActive ? world.shieldEnergy : world.energy}%`;
    if (world.beam) {
      text(
        "spell-name",
        world.beam.stage === "charging"
          ? "ПЕРЕХВАТ ЛУЧА"
          : world.beam.stage === "reflected"
            ? "ОТРАЖЕНИЕ УДАЛОСЬ"
            : world.beam.stage === "dispelled"
              ? "ЛУЧ ПОГЛОЩЁН"
              : "ЛУЧ ПРОБИЛ ЗАЩИТУ",
      );
      text(
        "progress-label",
        world.beam.stage === "charging"
          ? `ДО ВЫСТРЕЛА · ${(world.beam.remaining / 1000).toFixed(1)} С`
          : "",
      );
      el("progress-fill").style.width =
        `${(world.beam.hold / BEAM_HOLD_MS) * 100}%`;
    }
  }
  if (mode === "practice" && !world.practiceDone) {
    const instruction = {
      vortex:
        "Покажи ладонь → сожми кулак у обломков → раскрой ладонь для выброса.",
      shield: "Поставь открытую ладонь на траекторию и дождись атаки.",
      swipe:
        "Удержи указательный и средний пальцы, затем проведи ими через кристалл.",
      domain:
        "два пальца на обеих руках → удержи до свечения → раскрой обе ладони.",
    }[world.practice!];
    text(
      "spell-name",
      world.magic.label || names[lessons.indexOf(world.practice!)],
    );
    el("progress-fill").style.width = `${world.magic.progress * 100}%`;
    hint(
      control.quality ??
        (world.magic.hint ||
          (world.elapsed < world.hintUntil ? world.hint : instruction)),
      now,
    );
  } else
    hint(
      world.restMs > 0
        ? "Передышка. Опусти руки — таймер боя остановлен."
        : (control.quality ??
            (world.magic.stage !== "idle"
              ? world.magic.hint
              : world.beam
                ? world.beamHint
                : world.hint)),
      now,
    );
}
function updateInputGuide() {
  if (control.trackingGrace) return;
  const primary = !control.valid
    ? "не видна"
    : control.pinching
      ? "щипок"
      : control.spearSign
        ? "копьё · указательный + большой"
        : control.bladeSign
          ? "два пальца"
          : control.open
            ? "ладонь раскрыта"
            : control.fist
              ? "кулак"
              : "поза не принята";
  const secondary =
    control.secondQuality ??
    (!control.twoHands
      ? "не видна"
      : control.secondOpen
        ? "ладонь раскрыта"
        : control.secondFist
          ? "кулак"
          : control.secondSign
            ? "два пальца"
            : "рука в кадре");
  text("primary-hand-state", `${castingHand.id + 1} · АКТИВНА · ${primary}`);
  text("second-hand-state", `${2 - castingHand.id} · ${secondary}`);
  el("primary-hand-state").dataset.seen = String(control.valid);
  el("second-hand-state").dataset.seen = String(control.twoHands);
  text(
    "awakening-hands-status",
    `${castingHand.id + 1} ${primary} · ${2 - castingHand.id} ${secondary}`,
  );
  const magic = world?.magic;
  const domain =
    !!world &&
    (world.practice === "domain" ||
      magic?.stage !== "idle" ||
      !!magic?.domainHold ||
      (world.energy >= 100 &&
        !world.domainMs &&
        control.bladeSign &&
        control.secondSign));
  const visual =
    world?.practice ??
    (world?.magic.stage !== "idle" || world?.magic.domainHold
      ? "domain"
      : control.bindPose && world && world.phase >= 2
        ? "bind"
        : control.spearSign && world && world.phase >= 1
          ? "spear"
          : world?.magic.vortex
            ? "vortex"
            : world?.magic.bladeMs
              ? "swipe"
              : "shield");
  if (el("live-gesture-art").dataset.spell !== visual) {
    el("live-gesture-art").dataset.spell = visual;
    el("live-gesture-art").innerHTML = lessonArt(visual);
  }
  const blade = world?.practice === "swipe";
  el("second-hand-state").hidden = !domain && !control.twoHands;
  if (world?.practiceDone) {
    el("ritual-steps").hidden = true;
    return;
  }
  el("ritual-steps").hidden = !(domain || blade);
  const steps = domain
    ? ["Две печати · удержи печать", "Раскрой обе ладони"]
    : ["два пальца Печать одной рукой", "Взмах через цель"];
  const active = domain
    ? magic?.stage === "release"
      ? 1
      : 0
    : magic?.bladeMs
      ? 1
      : 0;
  el("ritual-steps")
    .querySelectorAll("li")
    .forEach((item, i) => {
      item.hidden = i >= steps.length;
      const label = `${i < active ? "Готово ·" : i + 1} ${steps[i] ?? ""}`;
      if (item.textContent !== label) item.textContent = label;
      item.classList.toggle("active", i === active);
      item.classList.toggle("done", i < active);
      if (i === active) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
  if (mode === "practice" && domain)
    text("progress-label", `ШАГ ${active + 1} / 2 · БЕЗ ТАЙМЕРА`);
  else if (mode === "practice" && blade)
    text("progress-label", `ШАГ ${active + 1} / 2`);
}
function frame(now: number) {
  const dt = Math.max(0, now - lastFrame);
  lastFrame = now;
  if (!document.hidden) {
    const updateUi = now - lastHud >= 50;
    if (updateUi) lastHud = now;
    if (model) {
      const expired = continuity.expire(control, now);
      if (expired !== control) {
        control = expired;
        mastery.pause();
        handOverlay.reset();
        text("tracking-status", "ПОКАЖИ РУКУ В КАДРЕ");
      }
      if (now - lastInference > 500 && control.valid) {
        // Expire stale controls, but let an already running newer detection
        // arrive. Only explicit mode changes should invalidate its epoch.
        clearMotion(false);
        mastery.pause();
        hand = null;
      }
      model.setHands(2);
      if ((mode === "battle" || mode === "practice") && world) {
        world.tick(
          Math.min(dt, 100),
          document.body.classList.contains("help-open")
            ? emptyControl()
            : control,
          document.body.classList.contains("help-open"),
        );
        if (world.magic.vortex) castingHand.consumePrimer();
        control = {
          ...control,
          released: false,
          slash: null,
          trackingInterrupted: false,
        };
        const events = world.drainEvents();
        scene.emit(events);
        events.forEach((event) => {
          sound.effect(event);
          if (event.type === "phase" || event.type === "domain") {
            el("cinematic").hidden = false;
            el("cinematic").dataset.kind = event.type;
            text("cinematic-title", event.text ?? "");
            text(
              "cinematic-kicker",
              event.type === "domain"
                ? "ТВОЯ СОБСТВЕННАЯ ТЕРРИТОРИЯ"
                : "РАЗЛОМ МЕНЯЕТСЯ",
            );
            cinematicUntil = now + 2700;
          }
        });
        if (updateUi) updateHud(now);
        if (world.practiceDone) {
          // Let the territory impact play, then wait indefinitely for a gesture.
          // This delay reveals the award; it never advances to another lesson.
          masteryRevealAt ||= now + (world.practice === "domain" ? 1800 : 250);
          if (now >= masteryRevealAt) revealMastery();
        } else if (
          mode === "battle" &&
          !world.ended &&
          world.phase > acceptedLevel
        )
          revealMastery(true);
        if (mode === "battle" && world?.ended) showResult();
      }
    }
    if (now > cinematicUntil) el("cinematic").hidden = true;
    sound.charge(
      (mode === "battle" || mode === "practice") && world && !world.paused
        ? world.magic.charge
        : 0,
    );
    sound.update(
      !model || document.body.classList.contains("help-open")
        ? "silent"
        : mode === "battle"
          ? world?.paused
            ? "silent"
            : world?.restMs
              ? "training"
              : "battle"
          : mode === "result" || mode === "idle"
            ? "silent"
            : "training",
      world?.phase ?? 0,
      !!world?.domainMs,
    );
    scene.presentation = {
      mode,
      reveal:
        mode === "awakening"
          ? Math.min(1, awakening.elapsed / 4200)
          : mode === "idle" || mode === "loading" || mode === "preparation"
            ? 0
            : 1,
      tear: awakening.complete ? 1 : awakening.spread,
    };
    if (updateUi) {
      updateInputGuide();
      const stats = model?.stats;
      text(
        "detector-stats",
        stats && now - stats.at < 2000
          ? `Отклик рук: ${stats.hz} обновл./с · ${stats.latency} мс · ${stats.delegate}`
          : model
            ? "Отклик рук: ждём кадр камеры…"
            : "Отклик рук: камера выключена",
      );
      text("detector-details", model ? (stats?.reason ?? "") : "");
    }
    drawHandOverlay(now);
    scene.draw(world, cursors.draw(control, now), now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
