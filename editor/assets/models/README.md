# Hand Landmarker asset

`hand_landmarker.task` is the float16 v1 task bundle from Google's MediaPipe model hosting:

https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`

Downloaded 2026-10-07. Model architecture, usage and model-card links:
https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker

The pinned browser runtime is `@mediapipe/tasks-vision@0.10.32` (Apache-2.0); RGB refinement uses `@techstark/opencv-js@4.11.0-release.1`. Dependency notices are distributed in their packages. The application serves the model, runtimes and WASM locally; no external model download occurs at inference time.
