import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { describeHand, GestureLesson, type Hand, type Lesson, type Point, type Reading } from './gestures';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="header"><a class="brand" href="./" aria-label="Разлом, главная"><span class="brand-mark">✳</span> РАЗЛОМ<span class="brand-en">RIFT</span></a><span class="edition">MOTION LAB <span>/</span> ПРОТОТИП 01</span><span class="header-status"><i></i> МАГИЯ В ТВОИХ РУКАХ</span></header>
  <main>
    <section class="intro"><div><p class="eyebrow">КАМЕРА ВМЕСТО ДЖОЙСТИКА</p><h1>По ту сторону <em>обычного.</em></h1><p class="lead">Твоя рука — источник силы. Освой три заклинания и пробуди разлом.</p></div><div class="chapter"><span>01—03</span><small>ИНИЦИАЦИЯ</small></div></section>
    <div class="workspace">
      <section class="arena" aria-label="Магическая арена">
        <div class="arena-top"><span><i class="live-dot"></i><span id="arena-status">ОЖИДАНИЕ МАГА</span></span><span id="counter">00 / 03</span></div>
        <canvas id="scene" aria-label="Разлом и положение руки"></canvas>
        <div class="portal-caption" id="portal-caption"><span>НЕСТАБИЛЬНЫЙ РАЗЛОМ</span><small>Для связи нужен проводник. Это ты.</small></div>
        <div class="start-panel" id="start-panel"><button id="start" class="primary">Пробудить силу <span>↗</span></button><p id="setup-note" role="status">Разреши камеру · покажи одну руку · следуй подсказкам</p><small>Видео обрабатывается на устройстве и не отправляется на сервер.</small></div>
        <div id="feedback" class="feedback" hidden><div class="feedback-label"><span id="spell-name">ЗАХВАТ ЭНЕРГИИ</span><span id="progress-label">0%</span></div><p id="hint" role="status" aria-live="polite"></p><div class="progress-track"><div id="progress-fill"></div></div></div>
        <div id="result" class="result" hidden><span class="result-mark">✳</span><p class="eyebrow">СВЯЗЬ УСТАНОВЛЕНА</p><h2>Ты пробудил разлом.</h2><p>Три заклинания. Одна новая сила.</p><div class="result-stats"><div><strong>3 / 3</strong><small>ЗАКЛИНАНИЯ</small></div><div><strong id="duration">—</strong><small>ВРЕМЯ ОБУЧЕНИЯ</small></div></div><button id="restart" class="primary">Повторить ритуал <span>↗</span></button><small id="restart-hint">Или убери руку из кадра и снова покажи открытую ладонь.</small></div>
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
let restartArmed = false;
let restartHold = 0;
let hintCandidate = '';
let hintSince = 0;

function setHint(text: string, now: number, immediate = false) {
  if (hintCandidate !== text) { hintCandidate = text; hintSince = now; }
  if ((immediate || now - hintSince > 220) && el('hint').textContent !== text) el('hint').textContent = text;
}

function updateSpellbook() {
  document.querySelectorAll<HTMLElement>('.spell').forEach((spell, i) => {
    spell.classList.toggle('active', i === step);
    spell.classList.toggle('done', i < step);
    spell.querySelector('.spell-check')!.textContent = i < step ? '✓' : '';
  });
  el('counter').textContent = `${String(Math.min(step, 3)).padStart(2, '0')} / 03`;
}

function resetLesson() {
  step = 0; elapsed = 0; nextStepAt = 0; evaluator.reset();
  reading = { hint: '', progress: 0, success: false, holding: false };
  el('result').hidden = true;
  el('feedback').hidden = false;
  el('spell-name').textContent = names[0];
  el('arena-status').textContent = 'ИНИЦИАЦИЯ';
  el('portal-caption').hidden = true;
  el('feedback').classList.remove('success');
  el('progress-fill').style.width = '0%';
  el('progress-label').textContent = '0%';
  el('restart-hint').textContent = 'Или убери руку из кадра и снова покажи открытую ладонь.';
  restartArmed = false; restartHold = 0;
  updateSpellbook();
  setHint('Покажи одну руку целиком, ладонью к камере', performance.now(), true);
}

function shutdown(note = 'Камера выключена. Можно начать снова.') {
  requestId++;
  running = false;
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  stream = null; video.srcObject = null;
  model?.close(); model = null;
  hand = null; points = []; evaluator.reset();
  sk.clearRect(0, 0, skeleton.width, skeleton.height);
  nextStepAt = 0; step = 0;
  el('start-panel').hidden = false;
  el('feedback').hidden = true;
  el('result').hidden = true;
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
el('restart').addEventListener('click', resetLesson);
window.addEventListener('pagehide', () => shutdown());
document.addEventListener('visibilitychange', () => {
  evaluator.reset(); hand = null; points = []; restartHold = 0;
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
  if (step < 3) elapsed += dt;
  if (nextStepAt && now >= nextStepAt) {
    step++; nextStepAt = 0; evaluator.reset(); updateSpellbook();
    reading = { hint: '', progress: 0, success: false, holding: false };
    if (step === 3) {
      el('feedback').hidden = true;
      el('result').hidden = false;
      el('duration').textContent = `${Math.round(elapsed / 1000)} с`;
      el('arena-status').textContent = 'ИНИЦИАЦИЯ ЗАВЕРШЕНА';
    } else {
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
  if (step === 3) {
    if (!hand) restartArmed = true;
    restartHold = restartArmed && hand?.open && !hand.quality ? restartHold + inferenceDt : 0;
    if (restartArmed) el('restart-hint').textContent = 'Покажи открытую ладонь и удерживай её 1,5 секунды для повтора.';
    if (restartHold > 1500) resetLesson();
    return;
  }
  if (nextStepAt) return;
  reading = evaluator.update(lessons[step], hand, now);
  setHint(reading.hint, now, reading.success);
  el('progress-fill').style.width = `${reading.progress * 100}%`;
  el('progress-label').textContent = `${Math.round(reading.progress * 100)}%`;
  el('feedback').classList.toggle('success', reading.success);
  if (reading.success) { nextStepAt = now + 1000; flashAt = now; }
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
  if (hand && !hand.quality && running && step < 3) {
    const px = hand.cursor.x * w, py = hand.cursor.y * h;
    ctx.strokeStyle = '#c9bfff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, reading.holding ? 15 : 9, 0, Math.PI * 2); ctx.stroke();
    if (reading.holding && step === 0) { ctx.shadowColor = '#ad91ff'; ctx.shadowBlur = 25; ctx.fillStyle = '#e3daff'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
    if (step === 1 && reading.progress > 0) { ctx.strokeStyle = `rgba(167,239,204,${reading.progress})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, radius * 1.3, 0, Math.PI * 2 * reading.progress); ctx.stroke(); }
    if (step === 2) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#ad91ff44'; ctx.strokeStyle = '#c4a8ff'; ctx.fillRect(-20, -20, 40, 40); ctx.strokeRect(-20, -20, 40, 40); ctx.restore(); }
  }
  const flash = 1 - (now - flashAt) / 900;
  if (flash > 0) { ctx.strokeStyle = `rgba(177,246,211,${flash})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, radius * (1 + (1 - flash)), 0, Math.PI * 2); ctx.stroke(); }
}

function animate(now: number) {
  const dt = Math.min(100, now - lastFrame); lastFrame = now;
  if (!document.hidden) { processFrame(now, dt); drawScene(now); }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
