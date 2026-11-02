const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;

const validSize = (width, height) =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

export function containRect(sourceWidth, sourceHeight, viewportWidth, viewportHeight) {
  if (!validSize(sourceWidth, sourceHeight) || !validSize(viewportWidth, viewportHeight)) return null;

  const scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
  };
}

export function broadcastLayout(videoWidth, videoHeight, hostWidth, hostHeight) {
  const source = containRect(videoWidth, videoHeight, hostWidth, hostHeight);
  const target = containRect(videoWidth, videoHeight, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  return source && target ? { source, target } : null;
}

export function cameraHome(videoWidth, videoHeight, hostWidth, hostHeight) {
  const frame = containRect(videoWidth, videoHeight, hostWidth, hostHeight);
  if (!frame || !validSize(hostWidth, hostHeight)) return null;

  const scale = frame.width * 0.16 / 2.24;
  const margin = frame.width * 0.03;
  return {
    x: frame.x + frame.width - margin - 1.4 * scale - hostWidth / 2,
    y: hostHeight / 2 - (frame.y + frame.height - margin),
    scale,
    frame,
  };
}
