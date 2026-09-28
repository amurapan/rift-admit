import { HandDetector, type Detection } from "./game/vision";
import { describeHand, type Hand, type Lesson } from "./gestures";
import { TutorialGate } from "./tutorial";
import { readBest, saveBest } from "./battle";
import { Arena, advice, type Advice } from "./game/arena";
import {
  Calibrator,
  DEFAULT_CALIBRATION,
  emptyControl,
  MotionControl,
  type Calibration,
} from "./game/control";
import { Scene } from "./game/scene";
import { CastingHand, CursorFollower } from "./game/tracking";
import { lessonArt } from "./game/lesson-art";
import { Awakening } from "./game/ritual";
import { Sound } from "./game/audio";
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
  if (el(id).textContent !== value) el(id).textContent = value;
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
  | "awakening"
  | "calibration"
  | "demo"
  | "practice"
  | "ready"
  | "battle"
  | "result" = "idle";
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
const castingHand = new CastingHand();
const cursors = new CursorFollower();
let calibrator = new Calibrator();
let calibration: Calibration = { ...DEFAULT_CALIBRATION };
let practiceList = [...lessons],
  lessonIndex = 0,
  practiceCompleteAt = 0;
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
history();

function hidePanels() {
  document.body.classList.remove("help-open");
  el("help").setAttribute("aria-expanded", "false");
  for (const id of [
    "awakening",
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
    spell.querySelector(".spell-check")!.textContent = spell.classList.contains(
      "done",
    )
      ? "✓"
      : "";
  });
}
function clearMotion() {
  model?.invalidate();
  cursors.reset();
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
  world = new Arena(lesson);
  practiceCompleteAt = 0;
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
      "Начерти свою территорию.",
    ][index],
  );
  text(
    "lesson-instruction",
    [
      "Покажи ладонь, затем сожми кулак рядом с обломками. Дождись яркого кольца и полностью раскрой ладонь — выпусти волну.",
      "Поставь открытую ладонь на светящуюся траекторию снаряда. Печать примет удар. Подними её перед попаданием, чтобы отразить атаку.",
      "Одна рука, два пальца: УКАЗАТЕЛЬНЫЙ и СРЕДНИЙ (✌). Согни безымянный и мизинец. Дождись свечения курсора ①, затем взмахни через кристалл.",
      "Три шага: две открытые ладони рядом → рука ① рисует круг щипком БОЛЬШОГО и УКАЗАТЕЛЬНОГО → две ладони в стороны. Подсказки покажут каждый шаг. В обучении можно не спешить.",
    ][index],
  );
  el("lesson-animation").innerHTML = lessonArt(lesson);
  el("lesson-demo").dataset.phase = "demo";
  text("lesson-arm", "Посмотри движение · 3");
  el("lesson-arm-progress").style.width = "0%";
  text("spell-name", names[index]);
  spellbook(index);
}
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
      "Сблизь две открытые ладони, затем нарисуй круг щипком.",
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
  text("result-mark", "✳");
  text("result-eyebrow", "МАГИЯ ПОДЧИНЯЕТСЯ ТЕБЕ");
  text("result-title", "Теперь удержи тьму.");
  text(
    "result-description",
    "Три фазы. Живое ядро. Один противник по ту сторону. Выбирай способности сам.",
  );
  text("result-value", "2:30");
  text("result-value-label", "НА ЗАКРЫТИЕ РАЗЛОМА");
  text("duration", "100%");
  text("duration-label", "ПРОЧНОСТЬ ЯДРА");
  text("restart", "Войти в разлом ↗");
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
    "Собирай врагов сжатием, отражай атаки и разрывай пространство.",
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
  text("result-mark", won ? "✳" : "◈");
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
    `Волны в цель: ${world.stats.burstHits}/${world.stats.bursts} · Отражения: ${world.stats.parries} · Разрезы: ${world.stats.cutHits}/${world.stats.cuts} · Территории: ${world.stats.domains}`,
  );
  text("advice-title", recommendation.title);
  text("advice-detail", recommendation.detail);
  text("restart", "Ещё один разлом ↗");
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
  text("start", "Войти в разлом ↗");
  text("setup-note", message);
  text("camera-badge", "КАМЕРА ВЫКЛ.");
  text("arena-status", "ОЖИДАНИЕ МАГА");
  text("tracking-status", "✧ СВЯЗЬ НЕ УСТАНОВЛЕНА");
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
    stream!.getVideoTracks()[0].onended = () =>
      shutdown("Камера отключилась. Подключи её и начни снова.");
    lastInference = 0;
    el("recalibrate").hidden = false;
    document.body.classList.add("camera-on");
    beginAwakening();
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
  text(
    "fullscreen",
    document.fullscreenElement ? "⤢ В окно" : "⤢ На весь экран",
  );
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
  text("sound", sound.enabled ? "♫ ЗВУК ВКЛ." : "♫ ЗВУК ВЫКЛ.");
  el("sound").setAttribute("aria-pressed", String(sound.enabled));
});
window.addEventListener("pagehide", () => shutdown());
document.addEventListener("visibilitychange", () => {
  clearMotion();
  hand = null;
  tutorial.pause();
  world?.magic.pause();
  awakening.hold = 0;
  awakening.armed = false;
  calibrator.fistMs = 0;
  lastFrame = performance.now();
  if (document.hidden) sound.suspend();
  else if (model) void sound.unlock();
  if (practiceCompleteAt) practiceCompleteAt = performance.now() + 700;
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
  const index = castingHand.choose(hands, sides);
  hand = index < 0 ? null : (hands[index] ?? null);
  control = motion.update(hand, hands[1 - index] ?? null, now, calibration);
  text(
    "tracking-status",
    hand ? (hand.quality ?? "✧ РУКА РАСПОЗНАНА") : "✧ ПОКАЖИ РУКУ В КАДРЕ",
  );
  if (
    skeleton.width !== video.videoWidth ||
    skeleton.height !== video.videoHeight
  ) {
    skeleton.width = video.videoWidth;
    skeleton.height = video.videoHeight;
  }
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  landmarks.forEach((points, i) => {
    sk.strokeStyle = i === index ? "#b4efd9" : "#e1c1ff";
    sk.fillStyle = sk.strokeStyle;
    sk.lineWidth = 2;
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
      sk.arc(p.x * skeleton.width, p.y * skeleton.height, 2.5, 0, Math.PI * 2);
      sk.fill();
    });
  });
  if (document.body.classList.contains("help-open")) return true;
  if (mode === "awakening") {
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
        : (hand?.quality ?? "Сожми кулак на полсекунды, когда будешь готов"),
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
    text(
      "boss-state",
      world.phase === 2
        ? world.exposed
          ? "ГЛАЗ ОТКРЫТ — АТАКУЙ"
          : "ГОТОВИТ ЗАЛП"
        : "ЗАЩИЩАЙ ЯДРО",
    );
    el("boss-fill").style.width =
      `${world.phase === 2 ? (world.bossHp / 240) * 100 : 100 - (world.elapsed / 65000) * 100}%`;
    text("shield-value", `${Math.round(world.shieldEnergy)}%`);
    text(
      "energy-value",
      world.energy >= 100 ? "ГОТОВА ∞" : `${Math.round(world.energy)}%`,
    );
    el("energy-value").classList.toggle("ready-energy", world.energy >= 100);
    el("countdown").hidden = world.status !== "countdown";
    text(
      "countdown-number",
      control.valid
        ? String(Math.max(1, Math.ceil(world.countdownMs / 1000)))
        : "◎",
    );
    el("battle-message").hidden = control.valid;
    text("battle-message", "Пауза · верни руку целиком в кадр");
    text(
      "spell-name",
      world.magic.label
        ? world.magic.label
        : world.shieldActive
          ? "ЩИТ АКТИВЕН"
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
      `${world.magic.domainHold > 0 ? world.magic.domainHold / 7 : world.magic.progress ? world.magic.progress * 100 : world.shieldActive ? world.shieldEnergy : world.energy}%`;
  }
  if (mode === "practice" && !world.practiceDone) {
    const instruction = {
      vortex:
        "Покажи ладонь → сожми кулак у обломков → раскрой ладонь для выброса.",
      shield: "Поставь открытую ладонь на траекторию и дождись атаки.",
      swipe:
        "Удержи указательный и средний пальцы, затем проведи ими через кристалл.",
      domain: "Сблизь две ладони → круг щипком → разведи открытые ладони.",
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
  } else hint(control.quality ?? world.hint, now);
}
function updateInputGuide() {
  const primary = !control.valid
    ? "не видна"
    : control.pinching
      ? "щипок · рисую"
      : control.bladeSign
        ? "✌ два пальца"
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
        : control.secondSign
          ? "✌ два пальца"
          : "раскрой ладонь");
  text("primary-hand-state", `① ${primary}`);
  text("second-hand-state", `② ${secondary}`);
  el("primary-hand-state").dataset.seen = String(control.valid);
  el("second-hand-state").dataset.seen = String(control.twoHands);
  text("awakening-hands-status", `① ${primary} · ② ${secondary}`);
  const magic = world?.magic;
  const domain =
    !!world &&
    (world.practice === "domain" ||
      magic?.stage !== "idle" ||
      (world.energy >= 100 && !world.domainMs));
  const blade = world?.practice === "swipe";
  el("second-hand-state").hidden = !domain && !control.twoHands;
  if (world?.practiceDone) {
    el("ritual-steps").hidden = true;
    return;
  }
  el("ritual-steps").hidden = !(domain || blade);
  const steps = domain
    ? ["Две ладони рядом", "Круг щипком · рука ①", "Две ладони в стороны"]
    : ["✌ Печать одной рукой", "Взмах через цель"];
  const active = domain
    ? magic?.stage === "draw"
      ? 1
      : magic?.stage === "release"
        ? 2
        : 0
    : magic?.bladeMs
      ? 1
      : 0;
  el("ritual-steps")
    .querySelectorAll("li")
    .forEach((item, i) => {
      item.hidden = i >= steps.length;
      const label = `${i < active ? "✓" : i + 1} ${steps[i] ?? ""}`;
      if (item.textContent !== label) item.textContent = label;
      item.classList.toggle("active", i === active);
      item.classList.toggle("done", i < active);
      if (i === active) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
  if (mode === "practice" && domain)
    text("progress-label", `ШАГ ${active + 1} / 3 · БЕЗ ТАЙМЕРА`);
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
      if (now - lastInference > 500 && control.valid) {
        clearMotion();
        hand = null;
      }
      model.submit(video, now);
      if ((mode === "battle" || mode === "practice") && world) {
        world.tick(
          Math.min(dt, 100),
          document.body.classList.contains("help-open")
            ? emptyControl()
            : control,
        );
        control = { ...control, released: false, slash: null };
        const events = world.drainEvents();
        scene.emit(events);
        events.forEach((event) => {
          sound.effect(event);
          if (event.type === "phase" || event.type === "domain") {
            el("cinematic").hidden = false;
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
        if (world.practiceDone && !practiceCompleteAt) {
          practiceCompleteAt = now + 1100;
          text("progress-label", "ОСВОЕНО");
          el("progress-fill").style.width = "100%";
          hint("Есть попадание. Способность освоена.", now, true);
        }
        if (practiceCompleteAt && now >= practiceCompleteAt) {
          lessonIndex++;
          if (lessonIndex < practiceList.length) introduceLesson();
          else {
            practiceCompleteAt = 0;
            ready();
          }
        }
        if (mode === "battle" && world?.ended) showResult();
      }
    }
    if (now > cinematicUntil) el("cinematic").hidden = true;
    sound.charge(world && !world.paused ? world.magic.charge : 0);
    sound.update(
      mode === "battle" && !!world && !world.paused && !world.ended,
      world?.phase ?? 0,
      !!world?.domainMs,
    );
    scene.presentation = {
      mode,
      reveal:
        mode === "awakening"
          ? Math.min(1, awakening.elapsed / 4200)
          : mode === "idle" || mode === "loading"
            ? 0
            : 1,
      tear: awakening.complete ? 1 : awakening.spread,
    };
    if (updateUi) updateInputGuide();
    scene.draw(world, cursors.update(control, dt), now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
