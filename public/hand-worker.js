/* Classic worker: MediaPipe's WASM loader uses importScripts. All assets stay local. */
let detector = null;
let files, options;
let delegate = "GPU";
let slowFrames = 0;
let busy = false;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      importScripts(`${data.assets}/vision_bundle.js`);
      files = await Vision.FilesetResolver.forVisionTasks(
        `${data.assets}/wasm`,
      );
      options = {
        baseOptions: {
          modelAssetPath: `${data.assets}/hand_landmarker.task`,
          delegate,
        },
        canvas: new OffscreenCanvas(640, 480),
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };
      try {
        detector = await Vision.HandLandmarker.createFromOptions(
          files,
          options,
        );
      } catch {
        delegate = "CPU";
        detector = await Vision.HandLandmarker.createFromOptions(files, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate },
        });
      }
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: String(error) });
    }
    return;
  }
  if (data.type !== "frame") return;
  const { bitmap, timestamp, epoch, width, height } = data;
  if (busy || !detector) {
    bitmap.close();
    self.postMessage({
      type: "error",
      message: "Detector received an overlapping frame",
    });
    return;
  }
  busy = true;
  try {
    const start = performance.now();
    const result = detector.detectForVideo(bitmap, timestamp);
    const inferenceMs = performance.now() - start;
    // Software WebGL can be much slower than WASM. Switch once rather than
    // letting a nominal GPU backend make every cursor update take half a second.
    slowFrames = inferenceMs > 100 ? slowFrames + 1 : 0;
    if (delegate === "GPU" && slowFrames >= 3) {
      detector.close();
      delegate = "CPU";
      detector = await Vision.HandLandmarker.createFromOptions(files, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate },
      });
    }
    self.postMessage({
      type: "result",
      timestamp,
      epoch,
      width,
      height,
      inferenceMs,
      delegate,
      landmarks: result.landmarks,
      sides: (result.handedness ?? []).map((categories) =>
        categories[0]?.score >= 0.7 ? categories[0].categoryName : null,
      ),
    });
  } catch (error) {
    self.postMessage({ type: "error", message: String(error) });
  } finally {
    bitmap.close();
    busy = false;
  }
};
