import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { describeHand, type Hand, type Lesson, type Point } from "./gestures";
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
import { Sound } from "./game/audio";
import { markup } from "./ui";
import "./style.css";
import "./battle.css";
import "./tutorial.css";
import "./arena.css";

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
const lessons: Lesson[] = ["pinch", "shield", "swipe"];
const names = ["ТЕЛЕКИНЕЗ", "ОТРАЖЕНИЕ", "РАЗРЕЗ"];
let mode:
  | "idle"
  | "loading"
  | "calibration"
  | "demo"
  | "practice"
  | "ready"
  | "battle"
  | "result" = "idle";
let model: HandLandmarker | null = null;
let stream: MediaStream | null = null;
let generation = 0;
let lastVideo = -1,
  lastInference = 0,
  lastFrame = performance.now();
let world: Arena | null = null;
let control = emptyControl();
let hand: Hand | null = null;
let previousPalm: Point | null = null;
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
  const saved = JSON.parse(localStorage.getItem("rift.runs.v2") ?? "[]");
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
  for (const id of [
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
          practiceList.length === 3 &&
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
  motion.reset();
  control = emptyControl();
  previousPalm = null;
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
const palmDrawing =
  '<path fill="#352441" stroke="#d9bcf7" stroke-width="2" d="M100 137 C86 129 79 115 71 104 L51 83 C46 76 54 69 61 74 L78 88 V41 C78 30 91 30 91 41 V75 V27 C91 16 105 16 105 27 V73 V20 C105 9 119 9 119 20 V73 V34 C119 23 133 23 133 34 V89 L139 84 C147 79 153 88 149 98 L140 122 C137 132 129 140 121 140 Z"/>';
function introduceLesson() {
  const lesson = practiceList[lessonIndex],
    index = lessons.indexOf(lesson);
  mode = "demo";
  world = new Arena(lesson);
  practiceCompleteAt = 0;
  tutorial.reset();
  clearMotion();
  hidePanels();
  el("lesson-demo").hidden = false;
  text(
    "arena-status",
    practiceList.length === 1 ? "ЛИЧНАЯ ТРЕНИРОВКА" : "ОСВОЕНИЕ МАГИИ",
  );
  text("counter", `${lessonIndex + 1} / ${practiceList.length}`);
  text("lesson-number", `СПОСОБНОСТЬ ${index + 1} · СНАЧАЛА ПОСМОТРИ`);
  text(
    "lesson-title",
    [
      "Поймай. Взмахни. Отпусти.",
      "Поставь щит на пути атаки.",
      "Проведи разрез через цель.",
    ][index],
  );
  text(
    "lesson-instruction",
    [
      "Наведи курсор на синий снаряд и соедини два пальца. Взмахни к глазу наверху и отпусти щипок, пока рука движется.",
      "Раскрой ладонь и поставь курсор на пунктирную траекторию. Дождись попадания в щит. Важна позиция руки.",
      "Раскрой ладонь. Быстро проведи курсором через кристалл. Можно двигаться горизонтально, вертикально или по диагонали.",
    ][index],
  );
  const drawing =
    index === 0
      ? '<path class="demo-guide" d="M90 115 L230 42"/><circle class="demo-pinch-ring demo-pinch-dot" cx="110" cy="96" r="10"/><ellipse class="demo-guide" cx="232" cy="40" rx="23" ry="12"/><text class="demo-small" x="60" y="151">ЩИПОК → ВЗМАХ → ОТПУСТИ</text>'
      : index === 1
        ? `<g transform="translate(55 0)">${palmDrawing}<circle class="demo-shield" cx="103" cy="83" r="62"/></g>`
        : `<path class="demo-guide" d="M40 92 H280"/><path fill="#9e62b0" stroke="#e5b4f7" d="M210 48 L233 85 L210 121 L187 85 Z"/><g transform="translate(60 0)"><g class="demo-swipe">${palmDrawing}</g></g>`;
  el("lesson-animation").innerHTML =
    `<svg viewBox="0 0 320 170" role="img" aria-label="Показ движения">${drawing}</svg>`;
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
      "Наведи курсор на синий снаряд и соедини большой и указательный пальцы",
      "Останови снаряд щитом: раскрой ладонь на пунктирной траектории",
      "Быстро проведи открытой ладонью через кристалл",
    ][lessons.indexOf(practiceList[lessonIndex])],
    performance.now(),
    true,
  );
}
function ready() {
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
    "Лови синие снаряды. Щит ставь на пути атаки. Разрезом пересекай кристаллы.",
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
    localStorage.setItem("rift.runs.v2", JSON.stringify(runs));
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
    `Возвраты: ${world.stats.returns}/${world.stats.throws} · Блоки: ${world.stats.blocks} · Парирования: ${world.stats.parries} · Разрезы в цель: ${world.stats.cutHits}/${world.stats.cuts}`,
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
  text("start", "Пробудить силу ↗");
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
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Для камеры открой сайт через HTTPS или localhost.");
    const acquired = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
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
    const files = await FilesetResolver.forVisionTasks(
      `${import.meta.env.BASE_URL}mediapipe/wasm`,
    );
    const options = {
      baseOptions: {
        modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`,
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };
    let loaded: HandLandmarker;
    try {
      loaded = await HandLandmarker.createFromOptions(files, options);
    } catch {
      loaded = await HandLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
    if (token !== generation) {
      loaded.close();
      return;
    }
    model = loaded;
    stream!.getVideoTracks()[0].onended = () =>
      shutdown("Камера отключилась. Подключи её и начни снова.");
    lastVideo = -1;
    lastInference = 0;
    el("recalibrate").hidden = false;
    document.body.classList.add("camera-on");
    beginCalibration();
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
function infer(now: number): boolean {
  if (
    !model ||
    video.readyState < 2 ||
    now - lastInference < 40 ||
    video.currentTime === lastVideo
  )
    return false;
  const dt = Math.min(100, now - lastInference);
  lastInference = now;
  lastVideo = video.currentTime;
  let landmarks: Point[][];
  try {
    landmarks = model.detectForVideo(video, now).landmarks;
  } catch (error) {
    console.error(error);
    shutdown("Распознавание остановилось. Включи камеру снова.");
    return false;
  }
  const hands = landmarks.map((points) =>
    describeHand(points, video.videoWidth / video.videoHeight),
  );
  let index = 0;
  if (previousPalm && hands.length > 1) {
    const d = (candidate: Hand | null) =>
      candidate
        ? Math.hypot(
            (candidate.palm ?? candidate.cursor).x - previousPalm!.x,
            (candidate.palm ?? candidate.cursor).y - previousPalm!.y,
          )
        : Infinity;
    if (d(hands[1]) < d(hands[0])) index = 1;
  }
  hand = hands[index] ?? null;
  previousPalm = hand?.palm ?? hand?.cursor ?? null;
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
  if (mode === "calibration") {
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
      world.held
        ? "ТЕЛЕКИНЕЗ · СНАРЯД В РУКЕ"
        : world.shieldActive
          ? "ЩИТ АКТИВЕН"
          : "СВОБОДНЫЙ БОЙ",
    );
    text(
      "progress-label",
      world.domainHold > 0
        ? "РАСШИРЕНИЕ…"
        : world.domainMs > 0
          ? "ВРЕМЯ ЗАМЕДЛЕНО"
          : world.combo > 2
            ? `СЕРИЯ ×${world.combo}`
            : "ВЫБИРАЙ СПОСОБНОСТЬ",
    );
    el("progress-fill").style.width =
      `${world.domainHold > 0 ? world.domainHold / 10 : world.held ? Math.min(100, world.heldMs / 6.5) : world.shieldActive ? world.shieldEnergy : world.energy}%`;
  }
  if (mode === "practice" && !world.practiceDone) {
    const instruction =
      world.practice === "pinch"
        ? world.held
          ? "Теперь взмахни к глазу и отпусти пальцы во время движения"
          : "Наведи курсор на синий снаряд и соедини большой и указательный пальцы"
        : world.practice === "shield"
          ? "Раскрой ладонь на пунктирной траектории и дождись снаряда"
          : "Быстро проведи открытой ладонью прямо через кристалл";
    hint(
      control.quality ??
        (world.elapsed < world.hintUntil ? world.hint : instruction),
      now,
    );
  } else hint(control.quality ?? world.hint, now);
}
function frame(now: number) {
  const dt = Math.max(0, now - lastFrame);
  lastFrame = now;
  if (!document.hidden) {
    if (model) {
      if (now - lastInference > 500) {
        clearMotion();
        hand = null;
      }
      infer(now);
      if ((mode === "battle" || mode === "practice") && world) {
        world.tick(dt, control);
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
        updateHud(now);
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
    sound.update(
      mode === "battle" && !!world && !world.paused && !world.ended,
      world?.phase ?? 0,
      !!world?.domainMs,
    );
    scene.draw(world, control, now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
