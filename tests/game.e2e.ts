import { expect, test, type Page } from "@playwright/test";

// Only the landmark model is replaced. Geometry, momentum, collisions, coaching,
// timers and UI are exercised unchanged. A separate test loads the actual model.
const fakeModel = `
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const HandLandmarker = { createFromOptions: async () => ({ close() {}, detectForVideo(_video, now) {
  const s = window.__testHand ?? { gesture: 'none', since: 0, point: {x:.5,y:.5} };
  if (s.gesture === 'none') return {landmarks:[]};
  let pose = s.gesture, point = {...s.point};
  if (s.to) {
    const t = Math.min(1,(now-s.since)/260);
    point = {x:s.point.x+(s.to.x-s.point.x)*t,y:s.point.y+(s.to.y-s.point.y)*t};
    if (pose === 'throw') pose = now-s.since < 145 ? 'pinch' : 'rest';
  }
  let p=[{x:.5,y:.8},{x:.4,y:.68},{x:.32,y:.6},{x:.26,y:.52},{x:.2,y:.43}];
  for (const x of [.35,.42,.5,.58]) for (const y of [.52,.4,.3,.2]) p.push({x,y});
  p=p.map(v=>({x:.5+(v.x-.5)*.6,y:.5+(v.y-.5)*.6,z:0}));
  if(pose==='pinch') p[4]={x:p[8].x+.012,y:p[8].y+.004,z:0};
  if(pose==='rest') for(const i of [5,9,13,17]) p[i+3]={...p[i],y:p[i].y+.04};
  const dx=.5225-(.2+point.x*.6),dy=.23+point.y*.54-.554;
  p=p.map(v=>({...v,x:v.x+dx,y:v.y+dy}));
  return {landmarks:[p]};
}}) };
`;
async function gesture(
  page: Page,
  gesture: string,
  point = { x: 0.5, y: 0.5 },
  to?: { x: number; y: number },
) {
  await page.evaluate(
    (data) => {
      (window as any).__testHand = { ...data, since: performance.now() };
    },
    { gesture, point, to },
  );
}
async function prepare(page: Page) {
  await expect(page.locator("#lesson-demo")).toHaveAttribute(
    "data-phase",
    "prepare",
    { timeout: 7000 },
  );
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeHidden();
}
async function observeArena(page: Page) {
  // Instrument the module the app actually loads, including Vite HMR queries.
  await page.route("**/src/game/arena.ts*", async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    await route.fulfill({
      response,
      contentType: "application/javascript",
      body:
        source +
        `
    const original = Arena.prototype.tick;
    Arena.prototype.tick = function (...args) {
      const value = original.apply(this, args);
      window.__snapshot = {
        status: this.status,
        practice: this.practice,
        phase: this.phase,
        held: !!this.held,
        entities: this.entities.map((e) => ({ ...e })),
        score: this.score,
      };
      return value;
    };`,
    });
  });
}
async function train(page: Page) {
  await page.route("**/@mediapipe_tasks-vision.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeModel }),
  );
  await observeArena(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Пробудить силу" }).click();
  await expect(page.locator("#calibration")).toBeVisible();
  await page
    .getByRole("button", { name: "Использовать стандартный размах" })
    .click();
  await prepare(page);
  await gesture(page, "pinch", { x: 0.3, y: 0.55 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot?.held))
    .toBe(true);
  await page.waitForTimeout(700);
  await gesture(page, "throw", { x: 0.3, y: 0.55 }, { x: 0.5, y: 0.22 });
  await expect(page.locator("#lesson-title")).toHaveText(
    "Поставь щит на пути атаки.",
  );
  // The same open palm must not silently complete the next lesson.
  await gesture(page, "open");
  await expect(page.locator("#lesson-demo")).toHaveAttribute(
    "data-phase",
    "prepare",
    { timeout: 7000 },
  );
  await page.waitForTimeout(900);
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await prepare(page);
  await gesture(page, "open", { x: 0.6, y: 0.64 });
  await expect(page.locator("#lesson-title")).toHaveText(
    "Проведи разрез через цель.",
    { timeout: 8000 },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/tutorial-mobile.png",
    fullPage: true,
  });
  await prepare(page);
  await gesture(page, "open", { x: 0.25, y: 0.25 });
  await page.waitForTimeout(260);
  await gesture(page, "open", { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 });
  await page.waitForTimeout(500);
  await expect(page.locator("#result")).toBeHidden();
  expect(await page.evaluate(() => (window as any).__snapshot.practice)).toBe(
    "swipe",
  );
  await gesture(page, "open", { x: 0.25, y: 0.5 });
  await page.waitForTimeout(400);
  await gesture(page, "open", { x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 });
  await expect(page.locator("#result")).toBeVisible();
  await expect(page.locator("#result-title")).toHaveText("Теперь удержи тьму.");
  await page.setViewportSize({ width: 1440, height: 1050 });
}
async function startWithPalm(page: Page) {
  await gesture(page, "none");
  await expect(page.locator("#restart-hint")).toContainText("Удерживай");
  await gesture(page, "open");
  await expect(page.locator("#result")).toBeHidden();
  await expect(page.locator("#countdown")).toBeHidden({ timeout: 6500 });
}

test("spatial training → free battle → pause → result and personalized drill", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await train(page);
  await startWithPalm(page);
  await gesture(page, "none");
  await expect(page.locator("#battle-message")).toContainText("Пауза");
  const time = await page.locator("#time-left").textContent();
  await page.waitForTimeout(1100);
  await expect(page.locator("#time-left")).toHaveText(time!);
  await gesture(page, "rest");
  // Observe entities without changing game state, then physically intercept an attack.
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__snapshot?.entities.some(
          (e: any) => e.kind === "orb" && e.telegraph <= 0,
        ),
      ),
    )
    .toBe(true);
  const orb = await page.evaluate(() =>
    (window as any).__snapshot.entities.find(
      (e: any) => e.kind === "orb" && e.telegraph <= 0,
    ),
  );
  await gesture(page, "pinch", { x: orb.x, y: orb.y });
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.held))
    .toBe(true);
  // Bring the captured projectile down before winding up: a spawn close to
  // the boss otherwise produces almost no hand travel and a weak throw.
  await gesture(page, "pinch", { x: 0.3, y: 0.55 });
  await page.waitForTimeout(700);
  await gesture(page, "throw", { x: 0.3, y: 0.55 }, { x: 0.5, y: 0.22 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.score))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/arena-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "test-results/arena-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await gesture(page, "rest");
  await expect(page.locator("#result")).toBeVisible({ timeout: 65000 });
  await expect(page.locator("#report")).toBeVisible();
  await expect(page.locator("#advice-detail")).not.toBeEmpty();
  const best = await page.locator("#best-score").textContent();
  await page.screenshot({
    path: "test-results/report-mobile.png",
    fullPage: true,
  });
  await gesture(page, "none");
  await expect(page.locator("#restart-hint")).toContainText("Кулак");
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await expect(page.locator("#arena-status")).toHaveText("ЛИЧНАЯ ТРЕНИРОВКА");
  await page.reload();
  await expect(page.locator("#best-score")).toHaveText(best!);
  expect(errors).toEqual([]);
});

test("real model initializes, camera shuts down, and denied permission is recoverable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Пробудить силу" }).click();
  await expect(page.locator("#calibration")).toBeVisible({ timeout: 60000 });
  await page.getByRole("button", { name: "Выключить камеру" }).click();
  expect(
    await page
      .locator("#camera")
      .evaluate((v: HTMLVideoElement) => v.srcObject),
  ).toBeNull();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Пробудить силу" }).click();
  await expect(page.locator("#setup-note")).toContainText("настройках сайта");
  await expect(page.locator("#start")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("comfortable-range calibration can be completed entirely by hand", async ({
  page,
}) => {
  await page.route("**/@mediapipe_tasks-vision.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fakeModel }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Пробудить силу" }).click();
  await expect(page.locator("#calibration")).toBeVisible();
  for (const point of [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
    { x: 0.8, y: 0.75 },
    { x: 0.2, y: 0.75 },
  ]) {
    await gesture(page, "open", point);
    await page.waitForTimeout(600);
  }
  await expect(page.locator("#calibration")).toHaveClass(/calibrated/);
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await page.getByRole("button", { name: "ЗВУК ВКЛ." }).click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "false");
});

test("boss and domain render using real arena state", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const arenaModule = "/src/game/arena.ts",
      sceneModule = "/src/game/scene.ts",
      controlModule = "/src/game/control.ts";
    const [{ Arena }, { Scene }, { emptyControl }] = await Promise.all([
      import(arenaModule),
      import(sceneModule),
      import(controlModule),
    ]);
    const canvas = document.createElement("canvas");
    canvas.id = "domain-proof";
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "900px",
      height: "700px",
      zIndex: "9999",
      background: "#101019",
    });
    document.body.append(canvas);
    const arena = new Arena();
    arena.status = "fighting";
    arena.elapsed = 70000;
    arena.energy = 100;
    const control = {
      ...emptyControl(),
      valid: true,
      domainPose: true,
      position: { x: 0.5, y: 0.6 },
    };
    arena.tick(1100, control);
    if (arena.stats.domains !== 1 || arena.domainMs <= 0)
      throw new Error("Domain did not activate");
    arena.spawn("orb", { x: 0.25, y: 0.4 });
    arena.spawn("armored", { x: 0.75, y: 0.45 });
    const renderer = new Scene(canvas);
    renderer.emit(arena.drainEvents());
    renderer.draw(arena, control, 1000);
  });
  await page
    .locator("#domain-proof")
    .screenshot({ path: "test-results/domain.png" });
});
