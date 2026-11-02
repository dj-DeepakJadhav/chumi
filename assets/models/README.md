# Local hand model

`hand_landmarker.task` is the Google MediaPipe Hand Landmarker float16 model, version 1.

Source: https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`

Runtime: `@mediapipe/tasks-vision` 1.2.0, pinned in package-lock.json. The server exposes its bundle and WASM through explicit local paths; it does not expose the rest of node_modules. The model and runtime load locally after camera startup. No CDN is required by the browser.

Official implementation reference: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js

This is a pretrained landmark model, not a model trained by this project. Inference uses CPU, one hand and a nominal 80 ms sampling interval; synchronous inference can affect frame rate on slower hardware.
