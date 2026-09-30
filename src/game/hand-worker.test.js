import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(
  new URL("../../public/hand-worker.js", import.meta.url),
  "utf8",
);
async function worker(renderer = "Intel hardware", rejectGPU = false) {
  const replies = [],
    delegates = [];
  let clock = 0,
    cost = 20;
  const self = { postMessage: (message) => replies.push(message) };
  const probe = {
    getExtension: (name) =>
      name === "WEBGL_debug_renderer_info"
        ? { UNMASKED_RENDERER_WEBGL: 1 }
        : null,
    getParameter: () => renderer,
  };
  const detector = {
    close: vi.fn(),
    setOptions: vi.fn(),
    detectForVideo: () => {
      clock += cost;
      return { landmarks: [], handedness: [] };
    },
  };
  runInNewContext(source, {
    self,
    importScripts() {},
    performance: { now: () => clock },
    OffscreenCanvas: class {
      getContext() {
        return probe;
      }
    },
    Vision: {
      FilesetResolver: { forVisionTasks: async () => ({}) },
      HandLandmarker: {
        createFromOptions: async (_files, options) => {
          delegates.push(options.baseOptions.delegate);
          if (rejectGPU && options.baseOptions.delegate === "GPU")
            throw Error("GPU initialization failed");
          return detector;
        },
      },
    },
  });
  await self.onmessage({ data: { type: "init", assets: "/mediapipe" } });
  return {
    delegates,
    replies,
    async frame(ms, numHands = 2) {
      cost = ms;
      const close = vi.fn();
      await self.onmessage({
        data: {
          type: "frame",
          bitmap: { close },
          timestamp: clock,
          epoch: 0,
          width: 640,
          height: 480,
          numHands,
        },
      });
      expect(close).toHaveBeenCalledOnce();
      return replies.at(-1);
    },
  };
}
it("keeps hardware acceleration when only initial GPU frames are slow", async () => {
  const w = await worker();
  for (const cost of [180, 160, 140, 120, 20, 20, 20, 20, 20, 20, 20])
    await w.frame(cost);
  expect(w.delegates).toEqual(["GPU"]);
  expect(w.replies.at(-1).delegate).toBe("GPU");
});
it("allows GPU warmup again after changing the number of hands", async () => {
  const w = await worker();
  for (let n = 0; n < 10; n++) await w.frame(20);
  for (const cost of [170, 150, 140, 20, 20, 20, 20, 20, 20])
    await w.frame(cost, 1);
  expect(w.delegates).toEqual(["GPU"]);
});
it("reports sustained slow GPU fallback after warmup", async () => {
  const w = await worker();
  for (let n = 0; n < 8; n++) await w.frame(20);
  for (let n = 0; n < 3; n++) await w.frame(150);
  expect(w.delegates).toEqual(["GPU", "CPU"]);
  expect(w.replies.at(-1).delegateReason).toContain("После прогрева");
});
it("explains software-renderer and GPU-initialization fallbacks", async () => {
  const software = await worker("SwiftShader");
  expect((await software.frame(50)).delegateReason).toContain(
    "программный WebGL",
  );
  expect(software.delegates).toEqual(["CPU"]);
  const failed = await worker("Intel hardware", true);
  expect((await failed.frame(50)).delegateReason).toContain(
    "Не удалось запустить",
  );
  expect(failed.delegates).toEqual(["GPU", "CPU"]);
});
