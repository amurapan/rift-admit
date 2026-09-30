import type { Point } from "../gestures";

export type Detection = {
  type: "result";
  landmarks: Point[][];
  sides: (string | null)[];
  timestamp: number;
  epoch: number;
  width: number;
  height: number;
  inferenceMs: number;
  delegate: string;
  delegateReason?: string;
};

/** One transferable camera frame at a time. No queued frames and no inference on the UI thread. */
export class HandDetector {
  private worker: Worker;
  private busy = false;
  private timings: { at: number; age: number }[] = [];
  stats: {
    hz: number;
    latency: number;
    at: number;
    delegate: string;
    reason: string;
  } | null = null;
  private closed = false;
  private epoch = 0;
  private video: HTMLVideoElement | null = null;
  private callback = 0;
  private captureWatchdog: ReturnType<typeof setInterval> | undefined;
  private lastVideoCallback = 0;
  private cameraFrame = -1;
  private numHands = 2;
  private usesVideoCallback = false;
  private lastVideo = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rejectLoad: ((error: Error) => void) | null = null;
  private constructor(
    private onResult: (result: Detection) => void,
    private onError: (error: Error) => void,
  ) {
    this.worker = new Worker(`${import.meta.env.BASE_URL}hand-worker.js`);
  }
  static async create(
    onResult: (result: Detection) => void,
    onError: (error: Error) => void,
    signal?: AbortSignal,
  ) {
    const detector = new HandDetector(onResult, onError);
    if (signal?.aborted) {
      detector.close();
      throw new Error("Detector loading cancelled");
    }
    const loading = detector.load();
    const cancel = () => detector.fail(new Error("Detector loading cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await loading;
      return detector;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  private load() {
    return new Promise<void>((resolve, reject) => {
      this.rejectLoad = reject;
      this.timer = setTimeout(
        () => this.fail(new Error("Detector loading timed out")),
        60000,
      );
      this.worker.onerror = (event) => this.fail(new Error(event.message));
      this.worker.onmessage = ({ data }) => {
        if (this.closed) return;
        if (data.type === "error") {
          this.fail(new Error(data.message));
        } else if (data.type === "ready") {
          clearTimeout(this.timer);
          this.rejectLoad = null;
          resolve();
        } else if (data.type === "result") {
          const at = performance.now();
          this.timings.push({ at, age: at - data.timestamp });
          this.timings = this.timings
            .filter((t) => at - t.at < 2000)
            .slice(-90);
          const span = at - this.timings[0].at;
          this.stats = {
            hz:
              span > 0
                ? Math.round(((this.timings.length - 1) * 1000) / span)
                : 0,
            latency: Math.round(
              this.timings.reduce((sum, t) => sum + t.age, 0) /
                this.timings.length,
            ),
            at,
            delegate: data.delegate,
            reason: data.delegateReason ?? "",
          };
          clearTimeout(this.timer);
          this.busy = false;
          if (
            data.epoch === this.epoch &&
            performance.now() - data.timestamp < 500
          )
            this.onResult(data);
          // A newer camera frame may have arrived while inference was running.
          if (this.video)
            this.submit(this.video, performance.now(), this.cameraFrame);
        }
      };
      this.worker.postMessage({
        type: "init",
        assets: new URL(
          `${import.meta.env.BASE_URL}mediapipe`,
          document.baseURI,
        ).href,
      });
    });
  }
  start(video: HTMLVideoElement) {
    this.video = video;
    this.cameraFrame = video.currentTime;
    this.lastVideoCallback = performance.now();
    this.submit(video, performance.now(), this.cameraFrame);
    this.usesVideoCallback =
      typeof video.requestVideoFrameCallback === "function";
    const tick = (_now: number, metadata?: VideoFrameCallbackMetadata) => {
      if (this.closed) return;
      this.lastVideoCallback = performance.now();
      this.cameraFrame = metadata?.mediaTime ?? video.currentTime;
      if (!document.hidden)
        this.submit(video, performance.now(), this.cameraFrame);
      this.callback = this.usesVideoCallback
        ? video.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    };
    this.callback = this.usesVideoCallback
      ? video.requestVideoFrameCallback(tick)
      : requestAnimationFrame(tick);
    // Video callbacks depend on presentation and can stop for an occluded
    // preview. Keep sampling decoded frames without accumulating a queue.
    this.captureWatchdog = setInterval(() => {
      if (this.closed || document.hidden) return;
      const now = performance.now();
      if (now - this.lastVideoCallback < 200) return;
      this.cameraFrame = video.currentTime;
      this.submit(video, now, this.cameraFrame);
    }, 100);
  }
  setHands(count: 1 | 2) {
    this.numHands = count;
  }
  submit(video: HTMLVideoElement, now: number, mediaTime = video.currentTime) {
    if (
      this.closed ||
      this.busy ||
      video.readyState < 2 ||
      document.hidden ||
      mediaTime === this.lastVideo
    )
      return;
    this.busy = true;
    this.lastVideo = mediaTime;
    const epoch = this.epoch;
    const width = video.videoWidth,
      height = video.videoHeight;
    this.timer = setTimeout(
      () => this.fail(new Error("Detector frame timed out")),
      15000,
    );
    void createImageBitmap(video)
      .then((bitmap) => {
        if (this.closed || epoch !== this.epoch) {
          bitmap.close();
          clearTimeout(this.timer);
          this.busy = false;
          return;
        }
        this.worker.postMessage(
          {
            type: "frame",
            bitmap,
            timestamp: now,
            epoch,
            width,
            height,
            numHands: this.numHands,
          },
          [bitmap],
        );
      })
      .catch((error) => this.fail(error));
  }
  invalidate() {
    this.epoch++;
    this.lastVideo = -1;
  }
  private fail(error: Error) {
    if (this.closed) return;
    const reject = this.rejectLoad;
    this.close();
    if (reject) reject(error);
    else this.onError(error);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.captureWatchdog);
    if (this.video) {
      if (this.usesVideoCallback)
        this.video.cancelVideoFrameCallback(this.callback);
      else cancelAnimationFrame(this.callback);
      this.video = null;
    }
    this.worker.terminate();
  }
}
