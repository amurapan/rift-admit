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
};

/** One transferable camera frame at a time. No queued frames and no inference on the UI thread. */
export class HandDetector {
  private worker: Worker;
  private busy = false;
  private closed = false;
  private epoch = 0;
  private lastSent = -Infinity;
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
          clearTimeout(this.timer);
          this.busy = false;
          if (
            data.epoch === this.epoch &&
            performance.now() - data.timestamp < 500
          )
            this.onResult(data);
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
  submit(video: HTMLVideoElement, now: number) {
    if (
      this.closed ||
      this.busy ||
      video.readyState < 2 ||
      video.currentTime === this.lastVideo ||
      now - this.lastSent < 33
    )
      return;
    this.busy = true;
    this.lastSent = now;
    this.lastVideo = video.currentTime;
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
          { type: "frame", bitmap, timestamp: now, epoch, width, height },
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
    this.worker.terminate();
  }
}
