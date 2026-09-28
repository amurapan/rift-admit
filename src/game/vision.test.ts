import { afterEach, expect, it, vi } from "vitest";
import { HandDetector } from "./vision";

class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (e: { data: any }) => void;
  onerror?: (e: { message: string }) => void;
  messages: any[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(data: any) {
    this.messages.push(data);
    if (data.type === "init")
      queueMicrotask(() => this.reply({ type: "ready" }));
  }
  reply(data: any) {
    this.onmessage?.({ data });
  }
}
const video = {
  readyState: 2,
  currentTime: 1,
  videoWidth: 640,
  videoHeight: 480,
} as HTMLVideoElement;
function setup() {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("document", { baseURI: "http://localhost/" });
  const bitmap = { close: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  return bitmap;
}
afterEach(() => vi.unstubAllGlobals());
it("keeps only one frame in flight, discards stale results and resumes with a fresh frame", async () => {
  setup();
  const result = vi.fn(),
    error = vi.fn();
  const detector = await HandDetector.create(result, error);
  const worker = FakeWorker.latest,
    now = performance.now();
  detector.submit(video, now);
  await Promise.resolve();
  detector.submit({ ...video, currentTime: 2 }, now + 40);
  expect(worker.messages.filter((m) => m.type === "frame")).toHaveLength(1);
  detector.invalidate();
  worker.reply({ ...worker.messages[1], type: "result" });
  expect(result).not.toHaveBeenCalled();
  detector.submit({ ...video, currentTime: 3 }, now + 80);
  await Promise.resolve();
  worker.reply({ ...worker.messages[2], type: "result" });
  expect(result).toHaveBeenCalledOnce();
  expect(error).not.toHaveBeenCalled();
  detector.close();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("closes a bitmap that finishes capturing after shutdown", async () => {
  const bitmap = setup();
  const detector = await HandDetector.create(vi.fn(), vi.fn());
  detector.submit(video, performance.now());
  detector.close();
  await Promise.resolve();
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(
    FakeWorker.latest.messages.filter((m) => m.type === "frame"),
  ).toHaveLength(0);
});
it("cancels model loading and terminates its worker", async () => {
  setup();
  const abort = new AbortController();
  const loading = HandDetector.create(vi.fn(), vi.fn(), abort.signal);
  abort.abort();
  await expect(loading).rejects.toThrow("cancelled");
  expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
});
it("ignores old frames and shuts down on detector failure", async () => {
  setup();
  const result = vi.fn(),
    error = vi.fn();
  const detector = await HandDetector.create(result, error);
  const worker = FakeWorker.latest;
  worker.reply({
    type: "result",
    epoch: 0,
    timestamp: performance.now() - 600,
  });
  expect(result).not.toHaveBeenCalled();
  worker.reply({ type: "error", message: "failed" });
  expect(error).toHaveBeenCalledOnce();
  expect(worker.terminate).toHaveBeenCalledOnce();
});
