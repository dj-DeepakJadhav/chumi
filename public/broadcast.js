const video = document.querySelector("#output");
const standby = document.querySelector("#standby");

let attachedStream = null;
let stopped = false;

const showStandby = (message) => {
  standby.textContent = message;
  standby.hidden = false;
};

const attachAvailableStream = async () => {
  if (stopped) return;
  if (window.opener?.closed) {
    video.pause();
    video.srcObject = null;
    attachedStream = null;
    showStandby("Broadcast source closed");
    return;
  }

  let sourceStream = null;
  try {
    sourceStream = window.opener?.chumiBroadcastStream ?? null;
  } catch {
    sourceStream = null;
  }

  if (!sourceStream || sourceStream === attachedStream) return;
  attachedStream = sourceStream;
  video.srcObject = sourceStream;
  try {
    await video.play();
  } catch {
    // Muted inline playback is normally automatic; retry while the source is live.
  }
};

const syncStatus = () => {
  if (window.opener?.closed) { showStandby("Broadcast source closed"); return; }
  const tracks = attachedStream?.getVideoTracks?.() ?? [];
  const live = tracks.some((track) => track.readyState === "live");
  if (!live) {
    if (attachedStream) showStandby("Broadcast is idle");
    return;
  }

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    standby.hidden = true;
  } else {
    showStandby("Preparing broadcast…");
  }
};

const timer = window.setInterval(() => {
  void attachAvailableStream();
  syncStatus();
}, 250);

video.addEventListener("playing", syncStatus);
video.addEventListener("loadeddata", syncStatus);
window.addEventListener("pagehide", () => {
  stopped = true;
  window.clearInterval(timer);
  video.pause();
  video.srcObject = null;
  attachedStream = null;
}, { once: true });

void attachAvailableStream();
