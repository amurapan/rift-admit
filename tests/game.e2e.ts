import { expect, test, type Page } from '@playwright/test';

// Replace only the model's output in this test. Real geometry, timers, gameplay,
// rendering, and result transitions remain unchanged. The camera smoke test below
// separately loads the real WASM/model against a virtual video stream.
const fakeModel = `
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async () => ({
  close() {},
  detectForVideo(_video, now) {
    const state = window.__testHand ?? { gesture: 'none', since: 0 };
    if (state.gesture === 'none') return { landmarks: [] };
    let p = [{x:.5,y:.8},{x:.4,y:.68},{x:.32,y:.6},{x:.26,y:.52},{x:.2,y:.43}];
    for (const x of [.35,.42,.5,.58]) for (const y of [.52,.4,.3,.2]) p.push({x,y});
    p = p.map(v => ({ x: .5 + (v.x-.5)*.6, y: .5 + (v.y-.5)*.6, z: 0 }));
    if (state.gesture === 'pinch') {
      p[4] = {x:p[8].x+.012,y:p[8].y+.004,z:0};
      const dx = .5-(p[4].x+p[8].x)/2, dy = .5-(p[4].y+p[8].y)/2;
      p = p.map(v => ({...v,x:v.x+dx,y:v.y+dy}));
    }
    if (state.gesture === 'swipe') {
      const offset = .15 - Math.min(1,(now-state.since)/300)*.3;
      p = p.map(v => ({...v,x:v.x+offset}));
    }
    if (state.gesture === 'swipe-start' || state.gesture === 'guided-swipe') {
      const travel = state.gesture === 'swipe-start' ? 0 : Math.min(1,(now-state.since)/300)*.34;
      // Start near the left edge of the target's tolerance: a rightward sweep
      // must be recognized relative to its origin, not an absolute end position.
      p = p.map(v => ({...v,x:v.x+.405-travel,y:v.y+.091}));
    }
    if (state.gesture === 'rest') for (const i of [5,9,13,17]) p[i+3] = {...p[i],y:p[i].y+.04};
    return { landmarks: [p] };
  }
}) };
`;

async function gesture(page: Page, value: string) {
  await page.evaluate(gesture => {
    (window as unknown as { __testHand: unknown }).__testHand = { gesture, since: performance.now() };
  }, value);
}

async function completeTraining(page: Page) {
  await page.route('**/@mediapipe_tasks-vision.js*', route => route.fulfill({ contentType: 'application/javascript', body: fakeModel }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Пробудить силу' }).click();
  await expect(page.locator('#lesson-demo')).toBeVisible();
  await prepareLesson(page);
  await gesture(page, 'pinch');
  await expect(page.locator('#spell-name')).toHaveText('НЕВИДИМЫЙ ЩИТ');
  // An already-open hand must never silently complete the next lesson.
  await gesture(page, 'open');
  await expect(page.locator('#lesson-demo')).toBeVisible();
  await expect(page.locator('#lesson-demo')).toHaveAttribute('data-phase', 'prepare', { timeout: 6000 });
  await page.waitForTimeout(1000);
  await expect(page.locator('#spell-name')).toHaveText('НЕВИДИМЫЙ ЩИТ');
  await expect(page.locator('#lesson-demo')).toBeVisible();
  await prepareLesson(page);
  await gesture(page, 'open');
  await expect(page.locator('#spell-name')).toHaveText('РАССЕКАЮЩИЙ УДАР');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/tutorial-mobile.png', fullPage: true });
  await prepareLesson(page);
  await gesture(page, 'swipe');
  await page.waitForTimeout(650);
  await expect(page.locator('#result')).toBeHidden();
  await gesture(page, 'swipe-start');
  await expect(page.locator('#swipe-guide')).toHaveAttribute('data-armed', 'true');
  await gesture(page, 'guided-swipe');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-title')).toHaveText('Теперь закрой разлом.');
  await page.setViewportSize({ width: 1440, height: 1050 });
}

async function prepareLesson(page: Page) {
  await expect(page.locator('#lesson-demo')).toHaveAttribute('data-phase', 'prepare', { timeout: 6000 });
  await gesture(page, 'rest');
  await expect(page.locator('#lesson-demo')).toBeHidden();
}

async function startWithPalm(page: Page) {
  await gesture(page, 'none');
  await expect(page.locator('#restart-hint')).toContainText('Удерживай');
  await gesture(page, 'open');
  await expect(page.locator('#result')).toBeHidden();
  await expect(page.locator('#countdown')).toBeHidden({ timeout: 6000 });
}

test('training → hands-free battle → victory → replay → defeat, record survives reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await completeTraining(page);
  await startWithPalm(page);

  // Tracking loss freezes both countdowns; the round does not punish a camera dropout.
  await gesture(page, 'none');
  await expect(page.locator('#battle-message')).toContainText('Пауза');
  const time = await page.locator('#time-left').textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator('#time-left')).toHaveText(time!);

  for (let cycle = 0; cycle < 3; cycle++) {
    await expect(page.locator('#spell-name')).toHaveText('ЗАХВАТ ЭНЕРГИИ');
    await gesture(page, 'pinch');
    await expect(page.locator('#spell-name')).toHaveText('НЕВИДИМЫЙ ЩИТ');
    await gesture(page, 'open');
    if (cycle === 0) await page.screenshot({ path: 'test-results/battle-desktop.png', fullPage: true });
    await expect(page.locator('#spell-name')).toHaveText('РАССЕКАЮЩИЙ УДАР');
    await gesture(page, 'swipe');
  }
  await expect(page.locator('#result-eyebrow')).toHaveText('ПОБЕДА · РАЗЛОМ ЗАКРЫТ');
  await expect(page.locator('#duration')).toHaveText('9 / 9');
  await expect(page.locator('#result-detail')).toContainText('Энергия: 3 · Щиты: 3 · Удары: 3');
  const record = await page.locator('#best-score').textContent();
  expect(Number(record!.replace(/\s/g, ''))).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/victory-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = await page.locator('#restart').boundingBox();
  const panel = await page.locator('#result').boundingBox();
  expect(button!.y + button!.height).toBeLessThan(panel!.y + panel!.height);
  await startWithPalm(page);
  await gesture(page, 'rest');
  await page.screenshot({ path: 'test-results/battle-mobile.png', fullPage: true });
  await expect(page.locator('#result-eyebrow')).toHaveText('ПОРАЖЕНИЕ · НОВАЯ ПОПЫТКА?', { timeout: 32000 });
  await expect(page.locator('#result-description')).toContainText('Защита иссякла');
  await page.reload();
  await expect(page.locator('#best-score')).toHaveText(record!);
  expect(errors).toEqual([]);
});

test('real camera pipeline initializes, shuts down, and recovers from denied permission', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Пробудить силу' }).click();
  await expect(page.locator('#lesson-demo')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#tracking-status')).toHaveText('ПОКАЖИ РУКУ В КАДРЕ');
  await page.getByRole('button', { name: 'Выключить камеру' }).click();
  expect(await page.locator('#camera').evaluate((v: HTMLVideoElement) => v.srcObject)).toBeNull();
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.reload();
  await page.getByRole('button', { name: 'Пробудить силу' }).click();
  await expect(page.locator('#setup-note')).toContainText('настройках сайта');
  await expect(page.locator('#start')).toBeEnabled();
  expect(errors).toEqual([]);
});
