import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { describeHand, GestureLesson, type Hand, type Lesson, type Point, type Reading } from './gestures';
import { ATTACK_MS, Battle, readBest, REQUIRED_SEALS, saveBest } from './battle';
import { TutorialGate } from './tutorial';
import './style.css';
import './battle.css';
import './tutorial.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="header"><a class="brand" href="./" aria-label="Разлом, главная"><span class="brand-mark">✳</span> РАЗЛОМ<span class="brand-en">RIFT</span></a><span class="edition">MOTION <span>/</span> ЗАКРОЙ РАЗЛОМ</span><span class="header-status"><i></i> МАГИЯ В ТВОИХ РУКАХ</span></header>
  <main>
    <section class="intro"><div><p class="eyebrow">КАМЕРА ВМЕСТО ДЖОЙСТИКА</p><h1>По ту сторону <em>обычного.</em></h1><p class="lead">Освой три заклинания. Удержи тьму. Закрой разлом за 60 секунд.</p></div><div class="chapter"><span id="best-score">0</span><small>ЛИЧНЫЙ РЕКОРД</small></div></section>
    <div class="workspace">
      <section class="arena" aria-label="Магическая арена">
        <div class="arena-top"><span><i class="live-dot"></i><span id="arena-status">ОЖИДАНИЕ МАГА</span></span><span id="counter">00 / 03</span></div>
        <canvas id="scene" aria-label="Разлом и положение руки"></canvas>
        <div id="battle-hud" class="battle-hud" hidden><div class="hud-stats"><div><small>ВРЕМЯ</small><strong id="time-left">60</strong></div><div><small>ЗАЩИТА</small><strong id="health" aria-label="3 жизни">◆ ◆ ◆</strong></div><div><small>ОЧКИ</small><strong id="score">0</strong></div></div><div class="seal-label"><span>ПЕЧАТЬ РАЗЛОМА</span><span id="seal-count">0 / 9</span></div><div class="seal-track"><div id="seal-fill"></div></div></div>
        <div id="countdown" class="countdown" hidden><span id="countdown-number">3</span><small>ПРИГОТОВЬ РУКУ</small></div>
        <div id="battle-message" class="battle-message" role="status" aria-live="polite" hidden></div>
        <div id="lesson-demo" class="lesson-demo" hidden><p class="eyebrow" id="lesson-number">ЗАКЛИНАНИЕ 01 / 03</p><h2 id="lesson-title"></h2><div id="lesson-animation"></div><p id="lesson-instruction"></p><div id="lesson-arm" class="lesson-arm" role="status"></div><div class="lesson-arm-track"><div id="lesson-arm-progress"></div></div></div>
        <div id="swipe-guide" class="swipe-guide" hidden><div></div><span>→</span><small>НАЧНИ ЗДЕСЬ</small><small>ВЕДИ СЮДА</small></div>
        <div class="portal-caption" id="portal-caption"><span>НЕСТАБИЛЬНЫЙ РАЗЛОМ</span><small>Для связи нужен проводник. Это ты.</small></div>
        <div class="start-panel" id="start-panel"><button id="start" class="primary">Пробудить силу <span>↗</span></button><p id="setup-note" role="status">Разреши камеру · покажи одну руку · следуй подсказкам</p><small>Видео обрабатывается на устройстве и не отправляется на сервер.</small></div>
        <div id="feedback" class="feedback" hidden><div class="feedback-label"><span id="spell-name">ЗАХВАТ ЭНЕРГИИ</span><span id="progress-label">0%</span></div><p id="hint" role="status" aria-live="polite"></p><div class="progress-track"><div id="progress-fill"></div></div><div id="attack-status" class="attack-status" hidden><span id="attack-label">ДО АТАКИ</span><strong id="attack-time">8,0 с</strong><div><div id="attack-fill"></div></div></div></div>
        <div id="result" class="result" hidden><span class="result-mark" id="result-mark">✳</span><p class="eyebrow" id="result-eyebrow">ИНИЦИАЦИЯ ЗАВЕРШЕНА</p><h2 id="result-title">Теперь закрой разлом.</h2><p id="result-description">60 секунд · 3 жизни · 9 печатей</p><div class="result-stats"><div><strong id="result-value">3 / 3</strong><small id="result-value-label">ЗАКЛИНАНИЯ</small></div><div><strong id="duration">—</strong><small id="duration-label">ВРЕМЯ ОБУЧЕНИЯ</small></div></div><p id="result-detail" class="result-detail"></p><button id="restart" class="primary">Начать испытание <span>↗</span></button><button id="retrain" class="text-button">Повторить обучение</button><small id="restart-hint">Убери руку из кадра, затем покажи ладонь для старта.</small><div class="result-gesture-track" aria-hidden="true"><div id="restart-progress"></div></div></div>
        <div class="arena-bottom"><span>✧ <span id="tracking-status">СВЯЗЬ НЕ УСТАНОВЛЕНА</span></span><button id="stop" hidden>Выключить камеру</button><span id="arena-note">ОДНА РУКА. ТРИ ЗАКЛИНАНИЯ.</span></div>
      </section>
      <aside>
        <section class="spellbook"><div class="section-title"><h2>Твои заклинания</h2><span>03</span></div>
          <div class="spell active" data-step="0"><div class="spell-icon">◈</div><div><span class="spell-number">01 / ПРИТЯЖЕНИЕ</span><h3>Захват энергии</h3><p>Соедини два пальца.<br> Перенеси искру в разлом.</p></div><span class="spell-check"></span></div>
          <div class="spell" data-step="1"><div class="spell-icon">⬡</div><div><span class="spell-number">02 / ЗАЩИТА</span><h3>Невидимый щит</h3><p>Раскрой ладонь.<br> Удерживай её на месте.</p></div><span class="spell-check"></span></div>
          <div class="spell" data-step="2"><div class="spell-icon">ϟ</div><div><span class="spell-number">03 / ИМПУЛЬС</span><h3>Рассекающий удар</h3><p>Взмахни открытой ладонью<br> горизонтально.</p></div><span class="spell-check"></span></div>
        </section>
        <section class="camera-card"><div class="section-title"><h2>Твой проводник</h2><span id="camera-badge">КАМЕРА ВЫКЛ.</span></div><div class="camera-view"><video id="camera" autoplay muted playsinline></video><canvas id="skeleton"></canvas><div id="camera-placeholder"><span>◎</span><p>Здесь появится твоя рука</p></div></div><p class="camera-tip">Расположись перед светом.<br>Оставь место для взмаха.</p></section>
      </aside>
    </div>
    <footer><span>ADMIT HACKATHON <span class="muted">/</span> 2026</span><span>Не нужно быть магом. Достаточно начать.</span><span>РАЗЛОМ <span class="muted">—</span> ИНИЦИАЦИЯ</span></footer>
  </main>`;

function el<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
const video = el<HTMLVideoElement>('camera');
const scene = el<HTMLCanvasElement>('scene');
const ctx = scene.getContext('2d')!;
const skeleton = el<HTMLCanvasElement>('skeleton');
const sk = skeleton.getContext('2d')!;
const start = el<HTMLButtonElement>('start');
const lessons: Lesson[] = ['pinch', 'shield', 'swipe'];
const names = ['ЗАХВАТ ЭНЕРГИИ', 'НЕВИДИМЫЙ ЩИТ', 'РАССЕКАЮЩИЙ УДАР'];
const evaluator = new GestureLesson();
const tutorial = new TutorialGate();
let swipeArmed = false;
let swipeStartMs = 0;
let swipeStartX = 0.3;
type Mode = 'training' | 'ready' | 'battle' | 'finished';
let mode: Mode = 'training';
let battle: Battle | null = null;
let bestScore = 0;
try { bestScore = readBest(localStorage); } catch { /* Some browsers deny access to the storage property itself. */ }
el('best-score').textContent = bestScore.toLocaleString('ru-RU');
let model: HandLandmarker | null = null;
let stream: MediaStream | null = null;
let running = false;
let requestId = 0;
let lastVideoTime = -1;
let lastInference = 0;
let step = 0;
let nextStepAt = 0;
let elapsed = 0;
let lastFrame = performance.now();
let hand: Hand | null = null;
let points: Point[] = [];
let reading: Reading = { hint: '', progress: 0, success: false, holding: false };
let flashAt = -10000;
let damageAt = -10000;
let lastCast: Lesson = 'pinch';
let trainingUnlocked = false;
let restartArmed = false;
let restartHold = 0;
let hintCandidate = '';
let hintSince = 0;

function setHint(text: string, now: number, immediate = false) {
  if (hintCandidate !== text) { hintCandidate = text; hintSince = now; }
  if ((immediate || now - hintSince > 220) && el('hint').textContent !== text) el('hint').textContent = text;
}

function updateSpellbook() {
  const active = mode === 'battle' && battle ? lessons.indexOf(battle.expected) : step;
  document.querySelectorAll<HTMLElement>('.spell').forEach((spell, i) => {
    spell.classList.toggle('active', i === active);
    spell.classList.toggle('done', mode !== 'battle' && i < step);
    spell.querySelector('.spell-check')!.textContent = mode === 'battle' ? '' : i < step ? '✓' : '';
  });
  el('counter').textContent = mode === 'battle' && battle ? `ВОЛНА ${Math.floor(battle.turn / 3) + 1}` : `${String(Math.min(step, 3)).padStart(2, '0')} / 03`;
}

function resetLesson() {
  mode = 'training'; battle = null;
  step = 0; elapsed = 0; nextStepAt = 0; evaluator.reset();
  reading = { hint: '', progress: 0, success: false, holding: false };
  el('result').hidden = true;
  el('feedback').hidden = false;
  el('spell-name').textContent = names[0];
  el('arena-status').textContent = 'ИНИЦИАЦИЯ';
  el('portal-caption').hidden = true;
  el('battle-hud').hidden = true;
  el('attack-status').hidden = true;
  el('countdown').hidden = true;
  el('battle-message').hidden = true;
  el('feedback').classList.remove('success');
  el('progress-fill').style.width = '0%';
  el('progress-label').textContent = '0%';
  el('restart-hint').textContent = 'Или убери руку из кадра и снова покажи открытую ладонь.';
  restartArmed = false; restartHold = 0;
  updateSpellbook();
  introduceLesson();
  setHint('Покажи одну руку целиком, ладонью к камере', performance.now(), true);
}

const palmDrawing = '<path class="demo-hand" d="M100 137 C86 129 79 115 71 104 L51 83 C46 76 54 69 61 74 L78 88 V41 C78 30 91 30 91 41 V75 V27 C91 16 105 16 105 27 V73 V20 C105 9 119 9 119 20 V73 V34 C119 23 133 23 133 34 V89 L139 84 C147 79 153 88 149 98 L140 122 C137 132 129 140 121 140 Z"/>';

function introduceLesson() {
  tutorial.reset(); swipeArmed = false; swipeStartMs = 0;
  el('lesson-demo').hidden = false;
  el('feedback').hidden = true;
  el('swipe-guide').hidden = true;
  el('lesson-number').textContent = `ЗАКЛИНАНИЕ 0${step + 1} / 03`;
  el('lesson-title').textContent = ['Создай и перенеси искру', 'Раскрой ладонь. Замри.', 'Взмахни слева направо'][step];
  el('lesson-instruction').textContent = [
    'Соедини большой и указательный пальцы. Не размыкая их, перенеси светящуюся искру в центр круга.',
    'Раскрой все пальцы и поверни ладонь к камере. Держи её на месте, пока зелёный круг не замкнётся.',
    'Поставь открытую ладонь в левый круг. Затем одним быстрым движением проведи её к правому кругу.',
  ][step];
  const drawing = step === 0
    ? '<path class="demo-hand" fill="none" d="M78 119 Q55 87 84 76 Q113 66 126 83 M159 118 Q176 81 157 53 Q143 40 130 60 L126 83"/><circle class="demo-pinch-ring" cx="126" cy="83" r="5"/><circle class="demo-pinch-ring demo-pinch-dot" cx="126" cy="83" r="5"/><path class="demo-guide" d="M177 82 H240"/><circle class="demo-guide" cx="260" cy="82" r="21"/><text class="demo-small" x="67" y="151">СОЕДИНИ → ПЕРЕНЕСИ</text>'
    : step === 1
      ? `<g transform="translate(55 0)">${palmDrawing}<circle class="demo-shield" cx="103" cy="83" r="62"/></g>`
      : `<path class="demo-guide" d="M58 82 H269 M258 71 L269 82 L258 93"/><g transform="translate(60 0)"><g class="demo-swipe">${palmDrawing}</g></g><text class="demo-small" x="55" y="156">СЛЕВА → НАПРАВО</text>`;
  el('lesson-animation').innerHTML = `<svg viewBox="0 0 320 170" role="img" aria-label="${el('lesson-title').textContent}">${drawing}</svg>`;
  el('lesson-arm').textContent = 'Посмотри движение · 3';
  el('lesson-arm-progress').style.width = '0%';
}

function resetReading() {
  evaluator.reset();
  reading = { hint: '', progress: 0, success: false, holding: false };
  el('feedback').classList.remove('success');
  el('progress-fill').style.width = '0%';
  el('progress-label').textContent = '0%';
}

function startBattle() {
  if (!running || !trainingUnlocked) return;
  battle = new Battle(); mode = 'battle'; step = 0; nextStepAt = 0;
  resetReading();
  el('lesson-demo').hidden = true;
  el('swipe-guide').hidden = true;
  el('result').hidden = true;
  el('battle-hud').hidden = false;
  el('attack-status').hidden = false;
  el('feedback').hidden = false;
  el('battle-message').hidden = true;
  el('arena-status').textContent = 'ЗАКРОЙ РАЗЛОМ';
  el('spell-name').textContent = names[0];
  restartArmed = false; restartHold = 0;
  updateSpellbook();
  updateBattleHud();
}

function showResult(finished: boolean) {
  mode = finished ? 'finished' : 'ready';
  step = 3; nextStepAt = 0;
  resetReading();
  el('lesson-demo').hidden = true;
  el('swipe-guide').hidden = true;
  restartArmed = false; restartHold = 0;
  el('feedback').hidden = true;
  el('battle-hud').hidden = true;
  el('attack-status').hidden = true;
  el('countdown').hidden = true;
  el('battle-message').hidden = true;
  el('result').hidden = false;
  el('restart-progress').style.width = '0%';
  el('restart-hint').textContent = 'Убери руку из кадра, затем покажи открытую ладонь для старта.';
  el('result').classList.toggle('defeat', finished && battle?.status === 'defeat');
  updateSpellbook();
  if (!finished || !battle) {
    trainingUnlocked = true;
    el('arena-status').textContent = 'ИНИЦИАЦИЯ ЗАВЕРШЕНА';
    el('result-mark').textContent = '✳';
    el('result-eyebrow').textContent = 'ИНИЦИАЦИЯ ЗАВЕРШЕНА';
    el('result-title').textContent = 'Теперь закрой разлом.';
    el('result-description').textContent = '60 секунд · 3 жизни · 9 печатей';
    el('result-value').textContent = '3 / 3';
    el('result-value-label').textContent = 'ЗАКЛИНАНИЯ';
    el('duration').textContent = `${Math.round(elapsed / 1000)} с`;
    el('duration-label').textContent = 'ВРЕМЯ ОБУЧЕНИЯ';
    el('result-detail').textContent = 'Выполняй показанное заклинание за 8 секунд. Каждое успешное действие приближает закрытие разлома.';
    el('restart').innerHTML = 'Начать испытание <span>↗</span>';
    return;
  }
  const victory = battle.status === 'victory';
  const newRecord = battle.score > bestScore;
  bestScore = Math.max(bestScore, battle.score);
  try { bestScore = saveBest(localStorage, bestScore); } catch { /* Keep an in-memory record if storage is unavailable. */ }
  el('best-score').textContent = bestScore.toLocaleString('ru-RU');
  el('arena-status').textContent = victory ? 'РАЗЛОМ ЗАКРЫТ' : 'ИСПЫТАНИЕ ЗАВЕРШЕНО';
  el('result-mark').textContent = victory ? '✳' : '◈';
  el('result-eyebrow').textContent = victory ? 'ПОБЕДА · РАЗЛОМ ЗАКРЫТ' : 'ПОРАЖЕНИЕ · НОВАЯ ПОПЫТКА?';
  el('result-title').textContent = victory ? 'Тьма отступила.' : 'Разлом оказался сильнее.';
  el('result-description').textContent = victory ? 'Все девять печатей на месте. Этот мир в безопасности.' : battle.reason === 'time' ? 'Время вышло. Ставь печати быстрее, чтобы успеть.' : 'Защита иссякла. Следи за подсказкой и временем до атаки.';
  el('result-value').textContent = battle.score.toLocaleString('ru-RU');
  el('result-value-label').textContent = newRecord ? 'НОВЫЙ РЕКОРД' : 'ОЧКИ';
  el('duration').textContent = `${battle.seals} / ${REQUIRED_SEALS}`;
  el('duration-label').textContent = 'ПЕЧАТИ';
  el('result-detail').textContent = `Лучшая серия: ${battle.maxCombo} · Энергия: ${battle.casts.pinch} · Щиты: ${battle.casts.shield} · Удары: ${battle.casts.swipe}`;
  el('restart').innerHTML = 'Ещё один разлом <span>↗</span>';
}

function updateBattleHud() {
  if (!battle) return;
  const tracking = !!hand && !hand.quality;
  const countdown = battle.status === 'countdown';
  el('countdown').hidden = !countdown;
  el('countdown-number').textContent = tracking ? String(Math.max(1, Math.ceil(battle.countdownMs / 1000))) : '◎';
  el('countdown').querySelector('small')!.textContent = tracking ? 'ПРИГОТОВЬСЯ' : 'ПОКАЖИ РУКУ В КАДРЕ';
  el('time-left').textContent = String(Math.ceil(battle.remainingMs / 1000)).padStart(2, '0');
  el('time-left').classList.toggle('danger', battle.remainingMs <= 10000);
  el('health').textContent = Array.from({ length: 3 }, (_, i) => i < battle!.health ? '◆' : '◇').join(' ');
  el('health').setAttribute('aria-label', `Осталось жизней: ${battle.health}`);
  el('score').textContent = battle.score.toLocaleString('ru-RU');
  el('seal-count').textContent = `${battle.seals} / ${REQUIRED_SEALS}`;
  el('seal-fill').style.width = `${battle.seals / REQUIRED_SEALS * 100}%`;
  el('attack-fill').style.width = `${battle.attackMs / ATTACK_MS * 100}%`;
  el('attack-status').classList.toggle('urgent', battle.attackMs < 2500);
  el('attack-label').textContent = battle.recoveryMs > 0 ? 'СЛЕДУЮЩАЯ АТАКА' : battle.expected === 'pinch' ? 'ДО ВЫБРОСА ЭНЕРГИИ' : battle.expected === 'shield' ? 'ДО ПОПАДАНИЯ' : 'ДО УДАРА КРИСТАЛЛА';
  el('attack-time').textContent = `${((battle.recoveryMs || battle.attackMs) / 1000).toFixed(1).replace('.', ',')} с`;
  const message = !tracking && !countdown ? 'Пауза · верни руку целиком в кадр' : battle.recoveryMs > 0 ? battle.event === 'damage' ? 'Защита повреждена · соберись' : `Печать поставлена · серия ${battle.combo}` : '';
  el('battle-message').hidden = !message;
  if (el('battle-message').textContent !== message) el('battle-message').textContent = message;
  el('battle-message').classList.toggle('damage', battle.event === 'damage' && tracking);
}

function shutdown(note = 'Камера выключена. Можно начать снова.') {
  requestId++;
  running = false;
  mode = 'training'; battle = null;
  document.body.classList.remove('camera-on');
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  stream = null; video.srcObject = null;
  model?.close(); model = null;
  hand = null; points = []; evaluator.reset();
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  nextStepAt = 0; step = 0;
  el('start-panel').hidden = false;
  el('feedback').hidden = true;
  el('result').hidden = true;
  el('lesson-demo').hidden = true;
  el('swipe-guide').hidden = true;
  el('battle-hud').hidden = true;
  el('attack-status').hidden = true;
  el('countdown').hidden = true;
  el('battle-message').hidden = true;
  el('stop').hidden = true;
  el('arena-note').hidden = false;
  el('portal-caption').hidden = false;
  el('camera-placeholder').hidden = false;
  el('camera-badge').textContent = 'КАМЕРА ВЫКЛ.';
  el('arena-status').textContent = 'ОЖИДАНИЕ МАГА';
  el('tracking-status').textContent = 'СВЯЗЬ НЕ УСТАНОВЛЕНА';
  el('setup-note').textContent = note;
  start.disabled = false;
  start.innerHTML = 'Пробудить силу <span>↗</span>';
  updateSpellbook();
}

start.addEventListener('click', async () => {
  const token = ++requestId;
  start.disabled = true;
  start.textContent = 'Подключаем камеру…';
  el('setup-note').textContent = 'Разреши доступ к камере в окне браузера.';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Для камеры открой сайт через HTTPS или localhost.');
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    if (token !== requestId) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = acquired;
    await video.play();
    if (token !== requestId) return;
    el('stop').hidden = false;
    el('arena-note').hidden = true;
    el('camera-placeholder').hidden = true;
    el('camera-badge').textContent = 'ПОДКЛЮЧЕНА';
    start.textContent = 'Настраиваем распознавание…';
    el('setup-note').textContent = 'Первая загрузка может занять несколько секунд.';
    const files = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
    const options = { baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/hand_landmarker.task`, delegate: 'GPU' as const }, runningMode: 'VIDEO' as const, numHands: 1, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 };
    let loaded: HandLandmarker;
    try { loaded = await HandLandmarker.createFromOptions(files, options); }
    catch { loaded = await HandLandmarker.createFromOptions(files, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
    if (token !== requestId) { loaded.close(); return; }
    model = loaded;
    stream!.getVideoTracks()[0].onended = () => shutdown('Камера отключилась. Подключи её и начни снова.');
    lastVideoTime = -1;
    running = true;
    document.body.classList.add('camera-on');
    el('start-panel').hidden = true;
    resetLesson();
  } catch (error) {
    if (token !== requestId) return;
    const name = error instanceof Error ? error.name : '';
    const message = name === 'NotAllowedError' ? 'Разреши доступ к камере в настройках сайта и попробуй снова.' : name === 'NotFoundError' ? 'Камера не найдена. Подключи веб-камеру и попробуй снова.' : name === 'NotReadableError' ? 'Камера занята другим приложением. Освободи её и попробуй снова.' : error instanceof Error && error.message.startsWith('Для камеры') ? error.message : 'Не удалось загрузить распознавание. Проверь подключение и попробуй снова.';
    console.error(error);
    shutdown(message);
  }
});
el('stop').addEventListener('click', () => shutdown());
el('restart').addEventListener('click', startBattle);
el('retrain').addEventListener('click', resetLesson);
window.addEventListener('pagehide', () => shutdown());
document.addEventListener('visibilitychange', () => {
  evaluator.reset(); hand = null; points = []; restartHold = 0;
  tutorial.pause(); swipeArmed = false; swipeStartMs = 0;
  // A success transition resumes after the tab is visible again.
  if (nextStepAt) nextStepAt = performance.now() + 900;
  lastFrame = performance.now();
});

const connections = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
function drawSkeleton() {
  if (video.videoWidth && (skeleton.width !== video.videoWidth || skeleton.height !== video.videoHeight)) { skeleton.width = video.videoWidth; skeleton.height = video.videoHeight; }
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  if (points.length !== 21) return;
  sk.strokeStyle = hand?.quality ? '#ffc586' : '#a8f0ca'; sk.fillStyle = sk.strokeStyle; sk.lineWidth = 2;
  connections.forEach(chain => {
    sk.beginPath(); chain.forEach((index, i) => { const p = points[index]; if (i) sk.lineTo(p.x * skeleton.width, p.y * skeleton.height); else sk.moveTo(p.x * skeleton.width, p.y * skeleton.height); }); sk.stroke();
  });
  points.forEach(p => { sk.beginPath(); sk.arc(p.x * skeleton.width, p.y * skeleton.height, 3, 0, Math.PI * 2); sk.fill(); });
}

function processFrame(now: number, dt: number) {
  if (!running || !model || video.readyState < 2 || document.hidden) return;
  if (now - lastInference > 500) { hand = null; points = []; restartHold = 0; }
  if (mode === 'training' && step < 3) elapsed += dt;
  if (mode === 'battle' && battle) {
    const previousTurn = battle.turn;
    const previousHealth = battle.health;
    battle.tick(dt, !!hand && !hand.quality);
    if (battle.health < previousHealth) {
      damageAt = now;
      resetReading();
      setHint('Не успел завершить заклинание. Готовься к следующему.', now, true);
    }
    if (battle.turn !== previousTurn) {
      resetReading();
      step = lessons.indexOf(battle.expected);
      updateSpellbook();
      el('spell-name').textContent = names[step];
      setHint(['Соедини пальцы и перенеси искру в центр разлома', 'Останови снаряд — раскрой ладонь и удерживай её', 'Разбей кристалл — взмахни открытой ладонью'][step], now, true);
    }
    updateBattleHud();
    if (battle.ended) showResult(true);
  }
  if (mode === 'training' && nextStepAt && now >= nextStepAt) {
    step++; nextStepAt = 0; evaluator.reset(); updateSpellbook();
    reading = { hint: '', progress: 0, success: false, holding: false };
    if (step === 3) {
      showResult(false);
    } else {
      introduceLesson();
      el('feedback').classList.remove('success');
      el('spell-name').textContent = names[step];
      setHint(step === 1 ? 'Раскрой ладонь и удерживай её на месте' : 'Взмахни открытой ладонью горизонтально', now, true);
    }
  }
  if (now - lastInference < 40 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const inferenceDt = Math.min(100, now - lastInference);
  lastInference = now;
  try {
    points = model.detectForVideo(video, now).landmarks[0] ?? [];
  } catch (error) {
    console.error(error);
    shutdown('Распознавание остановилось. Попробуй включить камеру снова.');
    return;
  }
  hand = describeHand(points, video.videoWidth / video.videoHeight);
  el('tracking-status').textContent = hand ? hand.quality ? 'ПОПРАВЬ ПОЛОЖЕНИЕ РУКИ' : 'РУКА РАСПОЗНАНА' : 'ПОКАЖИ РУКУ В КАДРЕ';
  drawSkeleton();
  if (mode === 'training' && tutorial.phase !== 'practice') {
    const practicing = tutorial.update(hand, now);
    el('lesson-demo').dataset.phase = tutorial.phase;
    const message = tutorial.phase === 'demo' ? `Посмотри движение · ${Math.max(1, Math.ceil(tutorial.remainingMs / 1000))}` : hand?.quality ?? 'Сожми кулак на полсекунды, когда будешь готов';
    if (el('lesson-arm').textContent !== message) el('lesson-arm').textContent = message;
    el('lesson-arm-progress').style.width = `${tutorial.fistMs / 400 * 100}%`;
    setHint(tutorial.phase === 'demo' ? 'Сначала посмотри пример. Сейчас жесты не засчитываются.' : 'Сожми кулак, затем выполни показанное движение.', now, true);
    if (practicing) {
      el('lesson-demo').hidden = true;
      el('feedback').hidden = false;
      el('swipe-guide').hidden = step !== 2;
      resetReading();
    }
    return;
  }
  if (mode === 'ready' || mode === 'finished') {
    if (!hand) restartArmed = true;
    restartHold = restartArmed && hand?.open && !hand.quality ? restartHold + inferenceDt : 0;
    if (restartArmed) el('restart-hint').textContent = 'Удерживай открытую ладонь 1,5 секунды, чтобы начать бой.';
    el('restart-progress').style.width = `${Math.min(100, restartHold / 1500 * 100)}%`;
    if (restartHold >= 1500) startBattle();
    return;
  }
  if (mode === 'battle' && battle && (battle.status === 'countdown' || battle.recoveryMs > 0)) {
    evaluator.reset();
    if (battle.status === 'countdown') setHint(hand?.quality ?? (hand ? 'Приготовь щипок: после отсчёта перенеси энергию в центр' : 'Покажи одну руку целиком, ладонью к камере'), now);
    return;
  }
  if (nextStepAt) return;
  if (mode === 'training' && step === 2 && !swipeArmed) {
    const atStart = hand?.open && !hand.quality && Math.hypot(hand.cursor.x - 0.3, hand.cursor.y - 0.48) < 0.13;
    swipeStartMs = atStart ? swipeStartMs + inferenceDt : 0;
    setHint(hand?.quality ?? (!hand ? 'Покажи руку целиком в кадре' : !hand.open ? 'Раскрой ладонь и поставь курсор в левый круг' : 'Наведи курсор на левый круг и ненадолго задержи руку'), now);
    el('swipe-guide').dataset.armed = 'false';
    if (swipeStartMs < 180) return;
    swipeArmed = true; swipeStartX = hand!.cursor.x; evaluator.reset();
    el('swipe-guide').dataset.armed = 'true';
    setHint('Теперь резко проведи ладонью вправо, к светящемуся кругу', now, true);
  }
  if (mode === 'training' && step === 2 && (!hand || hand.quality || !hand.open)) {
    swipeArmed = false; swipeStartMs = 0; evaluator.reset();
  }
  reading = evaluator.update(lessons[step], hand, now);
  if (mode === 'training' && step === 2 && reading.success && hand && hand.cursor.x < swipeStartX) {
    swipeArmed = false; swipeStartMs = 0; resetReading();
    setHint('Начни с левого круга и проведи ладонью вправо по стрелке', now, true);
    return;
  }
  setHint(reading.hint, now, reading.success);
  el('progress-fill').style.width = `${reading.progress * 100}%`;
  el('progress-label').textContent = `${Math.round(reading.progress * 100)}%`;
  el('feedback').classList.toggle('success', reading.success);
  if (reading.success) {
    flashAt = now; lastCast = lessons[step];
    if (mode === 'battle' && battle) {
      battle.cast(lessons[step]);
      updateBattleHud();
      if (battle.ended) showResult(true);
    } else nextStepAt = now + 1000;
  }
}

function drawScene(now: number) {
  const rect = scene.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (scene.width !== Math.round(rect.width * dpr) || scene.height !== Math.round(rect.height * dpr)) { scene.width = Math.round(rect.width * dpr); scene.height = Math.round(rect.height * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height, x = w / 2, y = h / 2;
  const radius = Math.min(w * 0.25, h * 0.27);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t = reduced ? 0 : now / 1000;
  ctx.clearRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.1);
  glow.addColorStop(0, '#7765ff22'); glow.addColorStop(0.5, '#6e57e519'); glow.addColorStop(1, '#6e57e500');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.save(); ctx.translate(x, y);
  for (let ring = 0; ring < 5; ring++) {
    ctx.save(); ctx.rotate(t * (ring % 2 ? -0.08 : 0.1) + ring * 0.7);
    ctx.strokeStyle = ring === 2 ? '#b8a9ffb0' : '#8f7ee838'; ctx.lineWidth = ring === 2 ? 1.5 : 0.8;
    ctx.beginPath(); ctx.ellipse(0, 0, radius * (0.75 + ring * 0.075), radius * (0.86 + ring * 0.06), ring * 0.2, 0, Math.PI * 2); ctx.stroke();
    if (ring === 3) {
      for (let n = 0; n < 40; n++) { const a = n / 40 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * radius * 1.12, Math.sin(a) * radius * 1.12); ctx.lineTo(Math.cos(a) * radius * 1.16, Math.sin(a) * radius * 1.16); ctx.stroke(); }
    }
    ctx.restore();
  }
  ctx.rotate(-t * 0.06);
  ctx.strokeStyle = '#a799ff45'; ctx.beginPath();
  for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3; const px = Math.cos(a) * radius * 0.77; const py = Math.sin(a) * radius * 0.77; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke();
  ctx.rotate(t * 0.06);
  ctx.fillStyle = '#dfd8ff'; ctx.font = `${radius * 0.42}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✳', 0, 0);
  ctx.restore();
  for (let i = 0; i < 42; i++) { const px = ((i * 137.5) % w), py = ((i * 73.3 + t * (3 + i % 3)) % h); ctx.fillStyle = `rgba(185,173,250,${0.08 + i % 4 * 0.06})`; ctx.fillRect(px, py, i % 3 === 0 ? 2 : 1, 2); }
  if (running && step < 3 && (mode === 'training' || mode === 'battle')) {
    const attacking = mode === 'battle' && battle?.status === 'fighting' && !battle.recoveryMs;
    if (step === 2) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4 + (reduced ? 0 : Math.sin(t) * 0.12));
      ctx.shadowBlur = 28; ctx.shadowColor = '#c695ff';
      ctx.fillStyle = '#6c428a'; ctx.strokeStyle = '#e0baff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-30, -30); ctx.lineTo(30, -30); ctx.lineTo(30, 30); ctx.lineTo(-30, 30); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = '#d4acff88'; ctx.beginPath(); ctx.moveTo(-30,-30); ctx.lineTo(30,30); ctx.moveTo(30,-30); ctx.lineTo(-30,30); ctx.stroke(); ctx.restore();
    }
    if (step === 1 && attacking && battle) {
      const approach = 1 - battle.attackMs / ATTACK_MS;
      const px = x + radius * (1.9 - approach * 1.15), py = y - radius * (1.45 - approach * 1.05);
      const fire = ctx.createRadialGradient(px, py, 0, px, py, 28);
      fire.addColorStop(0, '#fff0cc'); fire.addColorStop(0.2, '#ffc184'); fire.addColorStop(0.5, '#ef766499'); fire.addColorStop(1, '#ef766400');
      ctx.fillStyle = fire; ctx.beginPath(); ctx.arc(px, py, 28, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f7ae8955'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px + 12, py - 7); ctx.lineTo(px + 45, py - 27); ctx.stroke();
    }
    if (step === 1 && reading.progress > 0) {
      ctx.strokeStyle = `rgba(167,239,204,${reading.progress})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, radius * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reading.progress); ctx.stroke();
    }
  }
  if (hand && !hand.quality && running && step < 3 && (mode === 'training' || mode === 'battle')) {
    const px = hand.cursor.x * w, py = hand.cursor.y * h;
    ctx.strokeStyle = '#c9bfff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, reading.holding ? 15 : 9, 0, Math.PI * 2); ctx.stroke();
    if (reading.holding && step === 0) { ctx.shadowColor = '#ad91ff'; ctx.shadowBlur = 25; ctx.fillStyle = '#e3daff'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
  }
  const flash = 1 - (now - flashAt) / 900;
  if (flash > 0) { ctx.strokeStyle = `rgba(177,246,211,${flash})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, radius * (1 + (1 - flash)), 0, Math.PI * 2); ctx.stroke(); }
  if (flash > 0 && !reduced) {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const travel = (1 - flash) * radius * 1.4;
      ctx.fillStyle = lastCast === 'shield' ? `rgba(167,239,204,${flash})` : `rgba(219,183,255,${flash})`;
      ctx.fillRect(x + Math.cos(a) * travel, y + Math.sin(a) * travel, 3 + flash * 3, 3 + flash * 3);
    }
    if (lastCast === 'swipe') {
      ctx.strokeStyle = `rgba(231,216,255,${flash})`; ctx.lineWidth = flash * 5;
      ctx.beginPath(); ctx.moveTo(x - radius * 1.5, y + 12); ctx.lineTo(x + radius * 1.5, y - 12); ctx.stroke();
    }
  }
  const damage = 1 - (now - damageAt) / 650;
  if (damage > 0 && !reduced) { ctx.strokeStyle = `rgba(242,130,120,${damage * 0.65})`; ctx.lineWidth = 3; ctx.strokeRect(2, 2, w - 4, h - 4); }
}

function animate(now: number) {
  const dt = Math.max(0, now - lastFrame); lastFrame = now;
  if (!document.hidden) { processFrame(now, dt); drawScene(now); }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
