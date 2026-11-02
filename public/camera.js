const MODEL_PATH = "/models/hand_landmarker.task";
const VISION_BUNDLE_PATH = "/vendor/vision_bundle.mjs";
const WASM_PATH = "/vendor/wasm";
const SAMPLE_INTERVAL_MS = 80;

/**
 * Creates an explicitly started, local palm landmark camera.
 *
 * The camera is never requested until start() is called. Video frames and
 * landmarks stay in this page; only the static MediaPipe assets are fetched.
 */
export function createPalmCamera({ video, onResult, onStatus } = {}) {
  if (!video) throw new TypeError("A video element is required.");

  let generation = 0;
  let starting = false;
  let running = false;
  let startPromise = null;
  let stream = null;
  let landmarker = null;
  let animationFrame = null;
  let lastVideoTime = -1;
  let lastDetectAt = 0;
  let endedListener = null;

  const reportStatus = (state, message = "") => {
    try {
      onStatus?.({ state, message });
    } catch (error) {
      console.error("Palm camera status callback failed:", error);
    }
  };

  const stopTracks = (activeStream) => {
    activeStream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", endedListener);
      track.stop();
    });
  };

  const releaseResources = () => {
    let tracksEnded = false;
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    if (stream) {
      const tracks = stream.getTracks();
      stopTracks(stream);
      tracksEnded = tracks.length > 0 && tracks.every(track => track.readyState === "ended");
      stream = null;
    }
    video.pause?.();
    video.srcObject = null;
    video.hidden = true;
    if (landmarker) {
      try {
        landmarker.close();
      } catch (error) {
        console.warn("Could not close the palm landmark model:", error);
      }
      landmarker = null;
    }
    running = false;
    lastVideoTime = -1;
    lastDetectAt = 0;
    return tracksEnded;
  };

  const readableError = (error) => {
    switch (error?.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "Camera access was denied. Allow camera access in your browser settings and try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera was found on this device.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera is already in use or could not be started.";
      case "OverconstrainedError":
        return "No camera can meet the requested video settings.";
      default:
        return error?.message || "The camera could not be started. Please try again.";
    }
  };

  const deliverResult = (result, timestamp) => {
    const landmarks = result?.landmarks?.[0] ?? null;
    const classification = result?.handedness?.[0]?.[0];
    try {
      onResult?.({
        landmarks,
        handedness: classification?.categoryName ?? classification?.displayName ?? null,
        timestamp,
      });
    } catch (error) {
      console.error("Palm camera result callback failed:", error);
    }
  };

  const scheduleFrame = (token) => {
    if (token !== generation || !running) return;
    animationFrame = requestAnimationFrame((frameTime) => {
      animationFrame = null;
      if (token !== generation || !running || !landmarker) return;

      const now = performance.now();
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.currentTime !== lastVideoTime &&
        now - lastDetectAt >= SAMPLE_INTERVAL_MS
      ) {
        lastVideoTime = video.currentTime;
        lastDetectAt = now;
        try {
          const result = landmarker.detectForVideo(video, now);
          deliverResult(result, now);
        } catch (error) {
          generation += 1;
          starting = false;
          startPromise = null;
          releaseResources();
          reportStatus("error", `Palm tracking stopped: ${readableError(error)}`);
          return;
        }
      }

      scheduleFrame(token);
    });
  };

  const failStart = (token, error) => {
    if (token !== generation) return;
    starting = false;
    startPromise = null;
    releaseResources();
    reportStatus("error", readableError(error));
  };

  const begin = async (token) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is unavailable. Use a secure (HTTPS) page and try again.");
      }

      // Keep the pending stream local until permission resolves so stop() can
      // invalidate this startup and immediately stop a subsequently granted stream.
      const grantedStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
      });
      if (token !== generation) {
        stopTracks(grantedStream);
        return;
      }

      stream = grantedStream;
      endedListener = () => {
        if (token !== generation) return;
        generation += 1;
        starting = false;
        startPromise = null;
        releaseResources();
        reportStatus("error", "The camera stream ended. Check the camera connection and try again.");
      };
      stream.getTracks().forEach((track) => track.addEventListener("ended", endedListener));
      video.srcObject = stream;
      reportStatus("starting", "Camera access granted. Starting video preview…");
      // Chrome may defer playback of a display:none video. Do not wait for
      // 'running' to reveal it: that state itself depends on play() resolving.
      video.hidden = false;
      await video.play();
      if (token !== generation) {
        return;
      }

      reportStatus("starting", "Camera access granted. Loading the local hand model…");

      const { FilesetResolver, HandLandmarker } = await import(VISION_BUNDLE_PATH);
      if (token !== generation) {
        return;
      }
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      if (token !== generation) {
        return;
      }
      const createdLandmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MODEL_PATH,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      if (token !== generation) {
        createdLandmarker.close();
        return;
      }

      landmarker = createdLandmarker;
      starting = false;
      running = true;
      startPromise = null;
      reportStatus("running", "Camera is on. Show your palm to the camera.");
      scheduleFrame(token);
    } catch (error) {
      failStart(token, error);
    }
  };

  const start = () => {
    if (running) return Promise.resolve();
    if (starting) return startPromise;
    const token = ++generation;
    starting = true;
    reportStatus("starting", "Requesting camera access and loading palm tracking…");
    startPromise = begin(token);
    return startPromise;
  };

  const stop = () => {
    generation += 1;
    starting = false;
    startPromise = null;
    const tracksEnded = releaseResources();
    reportStatus("stopped", tracksEnded ? "Camera is off. Video tracks released." : "Camera is off.");
  };

  return {
    start,
    stop,
    get running() {
      return running;
    },
  };
}
