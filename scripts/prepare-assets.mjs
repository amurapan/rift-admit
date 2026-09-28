import { cp, mkdir, access, writeFile } from "node:fs/promises";

// Serve both WASM and the model from the same origin as the app.
const root = new URL("../public/mediapipe/", import.meta.url);
await mkdir(root, { recursive: true });
await cp(
  new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url),
  new URL("wasm/", root),
  { recursive: true },
);
await cp(
  new URL(
    "../node_modules/@mediapipe/tasks-vision/vision_bundle.js",
    import.meta.url,
  ),
  new URL("vision_bundle.js", root),
);
const model = new URL("hand_landmarker.task", root);
try {
  await access(model);
} catch {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    { signal: AbortSignal.timeout(60000) },
  );
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  await writeFile(model, new Uint8Array(await response.arrayBuffer()));
}
console.log("MediaPipe assets ready.");
