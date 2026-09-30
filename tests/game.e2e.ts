import { expect, test, type Page } from "@playwright/test";
// Only the landmark detector is replaced; gesture geometry, ritual state, physics
// and all UI transitions run in production modules, with a read-only observer.
const fakeModel = `
self.addEventListener('message',({data})=>{if(data.type==='test-hand')self.__testHand={...data.hand,since:performance.now()};});
var Vision={FilesetResolver:{forVisionTasks:async()=>({})},
HandLandmarker:{createFromOptions:async()=>({close(){},async setOptions(){},detectForVideo(_v,now){
 now=performance.now();
 const s=self.__testHand??{gesture:'none',point:{x:.5,y:.5},since:0};
 function hand(pose,point){
  if(pose==='none')return null;
  let p=[{x:.5,y:.8},{x:.4,y:.68},{x:.32,y:.6},{x:.26,y:.52},{x:.2,y:.43}];
  for(const x of [.35,.42,.5,.58])for(const y of [.52,.4,.3,.2])p.push({x,y});
  p=p.map(v=>({x:.5+(v.x-.5)*.6,y:.5+(v.y-.5)*.6,z:0}));
  if(pose==='pinch')p[4]={x:p[8].x+.012,y:p[8].y+.004,z:0};
  if(pose==='rest'||pose==='sign'||pose==='spear')for(const i of (pose==='spear'?[9,13,17]:pose==='sign'?[13,17]:[5,9,13,17]))p[i+3]={...p[i],y:p[i].y+.04};
  const dx=.5225-(.2+point.x*.6),dy=.23+point.y*.54-.554;
  return p.map(v=>({...v,x:v.x+dx,y:v.y+dy}));
 }
 let point={...s.point};
 if(s.to){const f=Math.min(1,(now-s.since)/300);point={x:s.point.x+(s.to.x-s.point.x)*f,y:s.point.y+(s.to.y-s.point.y)*f};}
 return {landmarks:[hand(s.gesture,point),s.second?hand(s.second.gesture,s.second.point):null].filter(Boolean)};
}})}};`;
async function gesture(
  page: Page,
  gesture: string,
  point = { x: 0.5, y: 0.5 },
  extra: Record<string, unknown> = {},
) {
  await page.evaluate(
    (data) => {
      (window as any).__testWorker?.postMessage({
        type: "test-hand",
        hand: data,
      });
    },
    { gesture, point, ...extra },
  );
}
async function observer(page: Page) {
  await page.route("**/src/game/arena.ts*", async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    await route.fulfill({
      response,
      contentType: "application/javascript",
      body:
        source +
        `\nconst original=Arena.prototype.tick;
  Arena.prototype.tick=function(...args){const result=original.apply(this,args);window.__snapshot={status:this.status,practice:this.practice,done:this.practiceDone,score:this.score,elapsed:this.elapsed,beam:this.beam?{...this.beam}:null,stats:{...this.stats},stage:this.magic.stage,vortex:!!this.magic.vortex,blade:this.magic.bladeMs,entities:this.entities.map(e=>({...e}))};return result;};`,
    });
  });
}
async function contained(page: Page, selector: string) {
  const rect = await page.locator(selector).boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height + 1);
}
async function observeDetector(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).__detectorFrames = 0;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        (window as any).__testWorker = this;
        this.addEventListener("message", ({ data }) => {
          if (data.type === "result") (window as any).__detectorFrames++;
        });
      }
    };
  });
}
async function setup(page: Page, inferenceDelay = 0, showPreparation = false) {
  await observeDetector(page);
  await page.route("**/mediapipe/vision_bundle.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fakeModel.replace(
        "now=performance.now();",
        `now=performance.now(); const until=now+${inferenceDelay}; while(performance.now()<until){}`,
      ),
    }),
  );
  await observer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Войти в разлом" }).click();
  await expect(page.locator("#preparation")).toBeVisible();
  if (!showPreparation) {
    for (let i = 0; i < 3; i++) await page.locator("#preparation-next").click();
    await expect(page.locator("#awakening")).toBeVisible();
  }
}
async function prepare(page: Page) {
  await expect(page.locator("#lesson-demo")).toHaveAttribute(
    "data-phase",
    "prepare",
    { timeout: 8000 },
  );
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeHidden();
}
async function palms(page: Page, apart = false) {
  await gesture(
    page,
    "open",
    { x: apart ? 0.16 : 0.4, y: 0.5 },
    { second: { gesture: "open", point: { x: apart ? 0.84 : 0.6, y: 0.5 } } },
  );
}
async function signs(page: Page, apart = false) {
  await gesture(
    page,
    "sign",
    { x: apart ? 0.12 : 0.35, y: 0.5 },
    { second: { gesture: "sign", point: { x: apart ? 0.88 : 0.65, y: 0.5 } } },
  );
}

test("immersive awakening → four physical lessons → battle → report and repeat", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.screenshot({ path: "test-results/entry.png" });
  await setup(page);
  await expect(page.locator("#skip-intro")).toBeVisible({ timeout: 10000 });
  await gesture(
    page,
    "sign",
    { x: 0.4, y: 0.5 },
    { second: { gesture: "sign", point: { x: 0.6, y: 0.5 } } },
  );
  await expect(page.locator("#awakening")).toHaveAttribute(
    "data-stage",
    "spread",
  );
  await page.screenshot({ path: "test-results/awakening.png" });
  await gesture(
    page,
    "sign",
    { x: 0.16, y: 0.5 },
    { second: { gesture: "sign", point: { x: 0.84, y: 0.5 } } },
  );
  await expect(page.locator("#lesson-title")).toHaveText("Сожми пространство.");
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contained(page, "#lesson-demo");
  await contained(page, ".camera-card");
  await page.screenshot({ path: "test-results/lesson-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await prepare(page);
  // The fist used to confirm the lesson must not silently trigger compression.
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).__snapshot.vortex)).toBe(
    false,
  );
  await gesture(page, "open");
  await page.waitForTimeout(220);
  await gesture(page, "rest");
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.vortex))
    .toBe(true);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: "test-results/vortex.png" });
  await gesture(page, "open");
  await expect(page.locator("#lesson-title")).toHaveText("Отрази его силу.");
  await page.waitForTimeout(700);
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await prepare(page);
  await gesture(page, "open", { x: 0.6, y: 0.64 });
  await expect(page.locator("#lesson-title")).toHaveText(
    "Оставь трещину в реальности.",
    { timeout: 9000 },
  );
  await prepare(page);
  await gesture(page, "open", { x: 0.2, y: 0.5 });
  await page.waitForTimeout(350);
  await gesture(page, "open", { x: 0.2, y: 0.5 }, { to: { x: 0.8, y: 0.5 } });
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => (window as any).__snapshot.done)).toBe(
    false,
  );
  await gesture(page, "sign", { x: 0.2, y: 0.5 });
  await page.waitForTimeout(600);
  await gesture(page, "sign", { x: 0.2, y: 0.5 }, { to: { x: 0.8, y: 0.5 } });
  await expect(page.locator("#lesson-title")).toHaveText(
    "Раскрой свою территорию.",
  );
  await prepare(page);
  await palms(page);
  await expect(page.locator("#hint")).toContainText("указательный и средний");
  await signs(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stage))
    .toBe("release");
  await page.screenshot({ path: "test-results/seal.png" });
  await palms(page, true);
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stats.domains))
    .toBe(1);
  await page.screenshot({ path: "test-results/territory.png" });
  await expect(page.locator("#result")).toBeVisible();
  await gesture(page, "none");
  await expect(page.locator("#restart-hint")).toContainText("Удерживай");
  await gesture(page, "open");
  await expect(page.locator("#result")).toBeHidden();
  await expect(page.locator("#countdown")).toBeHidden({ timeout: 6500 });
  await gesture(page, "none");
  await expect(page.locator("#battle-message")).toContainText("Пауза");
  const time = await page.locator("#time-left").textContent();
  await page.waitForTimeout(700);
  await expect(page.locator("#time-left")).toHaveText(time!);
  await gesture(page, "open", { x: 0.5, y: 0.35 });
  await page.waitForTimeout(250);
  await gesture(page, "rest", { x: 0.5, y: 0.35 });
  await page.waitForTimeout(1800);
  await gesture(page, "open");
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.score))
    .toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/battle.png" });
  // Leaving fullscreen keeps the complete game contained in the window.
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/battle-mobile.png" });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await gesture(page, "rest");
  await expect(page.locator("#result")).toBeVisible({ timeout: 85000 });
  await expect(page.locator("#advice-detail")).not.toBeEmpty();
  await page.screenshot({ path: "test-results/report-mobile.png" });
  await gesture(page, "none");
  await expect(page.locator("#restart-hint")).toContainText("Кулак");
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await expect(page.locator("#arena-status")).toHaveText("ЛИЧНАЯ ТРЕНИРОВКА");
  await page.reload();
  await page.getByRole("button", { name: "Войти в разлом" }).click();
  await page.locator("#preparation-skip").click();
  await expect(page.locator("#skip-training")).toBeVisible();
  expect(errors).toEqual([]);
});

test("real model loads, camera shuts down, permission refusal can be retried", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await observeDetector(page);
  await page.goto("/");
  await page.locator("#start").click();
  await expect(page.locator("#preparation")).toBeVisible({ timeout: 60000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__detectorFrames), {
      timeout: 60000,
    })
    .toBeGreaterThan(0);
  await page.locator("#stop").click();
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
  await page.locator("#start").click();
  await expect(page.locator("#setup-note")).toContainText("настройках сайта");
  await expect(page.locator("#start")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("help pauses combat; calibration, sound and fullscreen fallback remain usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("rift.ritual.trained", "yes");
    Element.prototype.requestFullscreen = async () => {
      throw new DOMException("Unsupported", "NotAllowedError");
    };
  });
  await setup(page);
  await page.locator("#skip-training").click();
  await gesture(page, "open");
  await expect(page.locator("#countdown")).toBeHidden({ timeout: 7000 });
  await page.locator("#help").click();
  const elapsed = await page.evaluate(() => (window as any).__snapshot.elapsed);
  await page.waitForTimeout(550);
  expect(await page.evaluate(() => (window as any).__snapshot.elapsed)).toBe(
    elapsed,
  );
  await page.locator("#recalibrate").click();
  await expect(page.locator("#calibration")).toBeVisible();
  await contained(page, "#calibration");
  await page.screenshot({ path: "test-results/calibration.png" });
  for (const point of [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
    { x: 0.8, y: 0.75 },
    { x: 0.2, y: 0.75 },
  ]) {
    await gesture(page, "open", point);
    await page.waitForTimeout(650);
  }
  await expect(page.locator("#calibration")).toHaveClass(/calibrated/);
  await gesture(page, "rest");
  await expect(page.locator("#lesson-demo")).toBeVisible();
  await page.locator("#sound").click();
  await expect(page.locator("#sound")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("territory teaches a two-hand sign, rejects wrong pose and survives tracking loss", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#help").click();
  await page.getByRole("button", { name: "Тренировать территорию" }).click();
  await prepare(page);
  await gesture(page, "open");
  await expect(page.locator("#hint")).toContainText("обе кисти");
  await palms(page);
  await expect(page.locator("#hint")).toContainText("указательный и средний");
  await signs(page, true);
  await expect(page.locator("#hint")).toContainText("небольшим зазором");
  expect(await page.evaluate(() => (window as any).__snapshot.stage)).toBe(
    "idle",
  );
  await signs(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stage))
    .toBe("release");
  await expect(
    page.locator('#ritual-steps [aria-current="step"]'),
  ).toContainText("Раскрой обе");
  await gesture(page, "none");
  await page.waitForTimeout(700);
  await gesture(page, "open");
  await expect(page.locator("#hint")).toContainText("Верни вторую");
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contained(page, "#feedback");
  await page.screenshot({ path: "test-results/domain-seal-mobile.png" });
  await palms(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stats.domains))
    .toBe(1);
  await page.screenshot({ path: "test-results/domain-release-mobile.png" });
  await expect(page.locator("#result")).toBeVisible();
});

test("preparation cards require fresh gestures and support mobile and keyboard fallback", async ({
  page,
}) => {
  await setup(page, 0, true);
  await page.screenshot({ path: "test-results/preparation-desktop.png" });
  await gesture(page, "open");
  await expect(page.locator("#preparation")).toHaveAttribute("data-step", "1");
  await page.waitForTimeout(1600);
  await expect(page.locator("#preparation")).toHaveAttribute("data-step", "1");
  await gesture(page, "rest");
  await page.waitForTimeout(350);
  await gesture(page, "open");
  await expect(page.locator("#preparation")).toHaveAttribute("data-step", "2");
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contained(page, ".preparation-card");
  await contained(page, "#preparation-next");
  await page.screenshot({ path: "test-results/preparation-mobile.png" });
  await page.locator("#preparation-next").click();
  await expect(page.locator("#awakening")).toBeVisible();
});

test("new techniques unlock in a short battle and hands can rest without pausing the break", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("rift.ritual.trained", "yes"),
  );
  await setup(page);
  await page.locator("#skip-training").click();
  await gesture(page, "spear", { x: 0.5, y: 0.3 });
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stats.spears), {
      timeout: 20000,
    })
    .toBe(1);
  await page.waitForTimeout(3800);
  expect(
    await page.evaluate(() => (window as any).__snapshot.stats.spears),
  ).toBe(1);
  await expect(page.locator("#rest-panel")).toBeVisible({ timeout: 9000 });
  await gesture(page, "none");
  const time = await page.locator("#time-left").textContent();
  await page.screenshot({ path: "test-results/rest.png" });
  await expect(page.locator("#rest-panel")).toBeHidden({ timeout: 6000 });
  await expect(page.locator("#time-left")).toHaveText(time!);
  await gesture(
    page,
    "open",
    { x: 0.35, y: 0.5 },
    { second: { gesture: "rest", point: { x: 0.65, y: 0.5 } } },
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__snapshot.stats.binds), {
      timeout: 11000,
    })
    .toBe(1);
  await page.screenshot({ path: "test-results/bind.png" });
  await page.locator("#help").click();
  await expect(page.locator('[data-extra="bind"]')).toHaveClass(/unlocked/);
  await page.screenshot({ path: "test-results/spellbook.png" });
});

test("slow inference stays in the worker while the interface keeps drawing", async ({
  page,
}) => {
  await setup(page, 200);
  await gesture(page, "open");
  // Measure steady operation after initial graphics allocation and resizing.
  await page.waitForTimeout(2500);
  const sample = await page.evaluate(
    () =>
      new Promise<{ frames: number; detections: number }>((resolve) => {
        const start = performance.now(),
          detections = (window as any).__detectorFrames;
        let frames = 0;
        const tick = (now: number) => {
          frames++;
          if (now - start < 1400) requestAnimationFrame(tick);
          else
            resolve({
              frames,
              detections: (window as any).__detectorFrames - detections,
            });
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(sample.detections).toBeGreaterThanOrEqual(2);
  // Rendering must outpace inference. Compare both measured rates rather than
  // assuming a particular GPU speed on the test machine. Synchronous inference
  // inside RAF cannot render multiple frames per detector result.
  expect(sample.frames).toBeGreaterThanOrEqual(sample.detections * 2);
  await page.locator("#stop").click();
  const stopped = await page.evaluate(() => (window as any).__detectorFrames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__detectorFrames)).toBe(
    stopped,
  );
});

test("camera tracking recovers when video presentation callbacks never arrive", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
    HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
  });
  await setup(page);
  await gesture(page, "open");
  await expect(page.locator("#tracking-status")).toContainText(
    "РУКА РАСПОЗНАНА",
  );
  await page.locator("#help").click();
  const before = await page.evaluate(() => (window as any).__detectorFrames);
  await expect
    .poll(() => page.evaluate(() => (window as any).__detectorFrames))
    .toBeGreaterThan(before + 2);
  await page.locator("#help").click();
  await expect(page.locator("#primary-hand-state")).toHaveAttribute(
    "data-seen",
    "true",
  );
  await page.locator("#stop").click();
  const stopped = await page.evaluate(() => (window as any).__detectorFrames);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).__detectorFrames)).toBe(
    stopped,
  );
});

test("boss ray explains errors and a held palm returns the attack", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("rift.ritual.trained", "yes"),
  );
  await setup(page);
  await page.locator("#skip-training").click();
  await gesture(page, "pinch", { x: 0.15, y: 0.5 });
  await expect(page.locator("#spell-name")).toHaveText("ПЕРЕХВАТ ЛУЧА", {
    timeout: 16000,
  });
  await expect(page.locator("#hint")).toContainText("Раскрой все пальцы");
  await gesture(page, "open", { x: 0.15, y: 0.5 });
  await expect(page.locator("#hint")).toContainText("Перемести курсор");
  await gesture(page, "open", { x: 0.5, y: 0.62 });
  await expect(page.locator("#hint")).toContainText("держи ладонь");
  await page.screenshot({ path: "test-results/beam-ready.png" });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__snapshot.stats.beamsReflected),
    )
    .toBe(1);
  await expect(page.locator("#spell-name")).toHaveText("ОТРАЖЕНИЕ УДАЛОСЬ");
  await page.screenshot({ path: "test-results/beam-return.png" });
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await contained(page, "#feedback");
  await page.locator("#stop").click();
});
