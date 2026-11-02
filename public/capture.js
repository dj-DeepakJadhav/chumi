import { broadcastLayout } from "./framing.js";

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const STREAM_FPS = 30;
const BACKGROUND = "#15121d";

/**
 * Copies the host's already-rendered camera and Chumi into a popup stream.
 * This deliberately owns no camera, renderer, or network connection.
 */
export function createBroadcast({ video, canvas, getSize, getState } = {}) {
  if (!video || !canvas) throw new TypeError("A source video and output canvas are required.");
  if (typeof getSize !== "function" || typeof getState !== "function") {
    throw new TypeError("getSize and getState callbacks are required.");
  }

  const outputCanvas = document.createElement("canvas");
  const context = outputCanvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D is unavailable.");

  outputCanvas.width = OUTPUT_WIDTH;
  outputCanvas.height = OUTPUT_HEIGHT;

  let popup = null;
  let stream = null;

  const clear = () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.restore();
  };

  const drawStandby = (message) => {
    clear();
    context.save();
    context.fillStyle = "#c9c3d4";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "500 28px system-ui, sans-serif";
    context.fillText(message, OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2, OUTPUT_WIDTH - 96);
    context.restore();
  };

  const draw = () => {
    if (!popup) return;
    if (popup.closed) { stop(); return; }

    let state;
    let size;
    try {
      state = getState() ?? {};
      size = getSize() ?? {};
    } catch {
      drawStandby("Broadcast is idle");
      return;
    }

    const width = Number(size.width);
    const height = Number(size.height);
    const sourceReady = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 && video.videoHeight > 0;
    if (!state.cameraOn || !state.visible || !sourceReady || width <= 0 || height <= 0) {
      drawStandby("Broadcast is idle");
      return;
    }

    const layout = broadcastLayout(video.videoWidth, video.videoHeight, width, height);
    const rendererWidth = Number(canvas.width);
    const rendererHeight = Number(canvas.height);
    if (!layout || rendererWidth <= 0 || rendererHeight <= 0) {
      drawStandby("Broadcast is idle");
      return;
    }

    clear();
    context.save();
    const { target, source } = layout;
    context.translate(target.x * 2 + target.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight,
      target.x, target.y, target.width, target.height);
    context.restore();

    // The WebGL canvas is already a transparent compositing layer; draw it
    // after the mirrored camera so Chumi remains in front, using the same
    // video-aligned crop at the renderer's backing pixel ratio.
    context.drawImage(canvas,
      source.x * rendererWidth / width, source.y * rendererHeight / height,
      source.width * rendererWidth / width, source.height * rendererHeight / height,
      target.x, target.y, target.width, target.height);

    const caption = typeof state.caption === "string" ? state.caption.trim().slice(0, 72) : "";
    if (caption) {
      const lines = caption.match(/.{1,36}(?:\s|$)|\S.{0,35}/g)?.slice(0, 2) ?? [caption];
      const lineHeight = 32;
      const captionHeight = lines.length * lineHeight + 18;
      context.save();
      context.fillStyle = "rgba(18, 15, 25, 0.72)";
      context.fillRect(32, 20, OUTPUT_WIDTH - 64, captionHeight);
      context.fillStyle = "#ffffff";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 28px system-ui, sans-serif";
      lines.forEach((line, index) => {
        context.fillText(line.trim(), OUTPUT_WIDTH / 2,
          20 + captionHeight / 2 + lineHeight * (index - (lines.length - 1) / 2), OUTPUT_WIDTH - 112);
      });
      context.restore();
    }
  };

  const fitWindow = () => {
    if (!popup || popup.closed || typeof popup.resizeTo !== "function") return false;
    try {
      const borderWidth = Math.max(0, popup.outerWidth - popup.innerWidth) || 0;
      const borderHeight = Math.max(0, popup.outerHeight - popup.innerHeight) || 0;
      const availableWidth = (popup.screen?.availWidth || OUTPUT_WIDTH + borderWidth + 32) - borderWidth - 32;
      const availableHeight = (popup.screen?.availHeight || OUTPUT_HEIGHT + borderHeight + 32) - borderHeight - 32;
      const width = Math.max(320, Math.floor(Math.min(OUTPUT_WIDTH, availableWidth, availableHeight * 16 / 9) / 16) * 16);
      popup.resizeTo(width + borderWidth, width * 9 / 16 + borderHeight);
      return true;
    } catch { return false; }
  };

  const open = () => {
    if (popup && !popup.closed) {
      fitWindow();
      popup.focus();
      return true;
    }

    let nextPopup;
    try {
      nextPopup = window.open("/broadcast", "chumi-broadcast", "popup,width=1280,height=720");
    } catch {
      return false;
    }
    if (!nextPopup) return false;

    try {
      if (!stream) stream = outputCanvas.captureStream(STREAM_FPS);
      popup = nextPopup;
      window.chumiBroadcastStream = stream;
      fitWindow();
      popup.focus();
      return true;
    } catch {
      nextPopup.close();
      popup = null;
      return false;
    }
  };

  const stop = () => {
    if (window.chumiBroadcastStream === stream) delete window.chumiBroadcastStream;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (popup && !popup.closed) popup.close();
    popup = null;
  };

  window.addEventListener("pagehide", stop, { once: true });

  return {
    open,
    draw,
    stop,
    fitWindow,
    get isOpen() { return Boolean(popup && !popup.closed && stream); },
  };
}
