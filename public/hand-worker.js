/* Classic worker: MediaPipe's WASM loader uses importScripts. All assets stay local. */
let detector = null;
let files, options;
let delegate = "GPU";
let delegateReason = "Обработка на GPU через WebGL 2";
let processedFrames = 0;
let slowFrames = 0;
let busy = false;
let numHands = 2;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      importScripts(`${data.assets}/vision_bundle.js`);
      files = await Vision.FilesetResolver.forVisionTasks(
        `${data.assets}/wasm`,
      );
      // Software WebGL can take seconds to compile its first inference. Prefer
      // WASM immediately when the browser exposes a software renderer.
      const probe = new OffscreenCanvas(1, 1).getContext("webgl2");
      const debug = probe?.getExtension("WEBGL_debug_renderer_info");
      const renderer = debug
        ? probe.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : "";
      if (!probe || /swiftshader|llvmpipe|lavapipe|software/i.test(renderer)) {
        delegate = "CPU";
        delegateReason = !probe
          ? "WebGL 2 недоступен — обработка на процессоре"
          : "Браузер использует программный WebGL — обработка на процессоре";
      }
      probe?.getExtension("WEBGL_lose_context")?.loseContext();
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
        delegateReason =
          "Не удалось запустить модель на GPU — обработка на процессоре";
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
    if (
      data.numHands !== numHands &&
      (data.numHands === 1 || data.numHands === 2)
    ) {
      numHands = data.numHands;
      options.numHands = numHands;
      await detector.setOptions({ numHands });
      processedFrames = 0;
      slowFrames = 0;
    }
    const start = performance.now();
    const result = detector.detectForVideo(bitmap, timestamp);
    const inferenceMs = performance.now() - start;
    // Software WebGL can be much slower than WASM. Switch once rather than
    // letting a nominal GPU backend make every cursor update take half a second.
    processedFrames++;
    // Initial GPU frames include shader compilation; do not mistake that
    // one-time warmup for the steady-state performance of the GPU.
    slowFrames = processedFrames > 8 && inferenceMs > 100 ? slowFrames + 1 : 0;
    if (delegate === "GPU" && slowFrames >= 3) {
      detector.close();
      delegate = "CPU";
      delegateReason =
        "После прогрева GPU обрабатывал кадры дольше 100 мс — выбран процессор";
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
      delegateReason,
      numHands,
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
