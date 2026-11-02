import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastLayout, cameraHome, containRect} from '../public/framing.js';

const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) <= epsilon,
  `${actual} is not within ${epsilon} of ${expected}`);

test('containRect centers common video and viewport aspect ratios without cropping', () => {
  for (const [vw, vh, hw, hh] of [
    [640, 480, 1280, 720],
    [1920, 1080, 600, 900],
    [1080, 1920, 1600, 900],
    [640, 480, 640, 480],
  ]) {
    const rect = containRect(vw, vh, hw, hh);
    assert.ok(rect);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= hw + 1e-9);
    assert.ok(rect.y + rect.height <= hh + 1e-9);
    near(rect.width / rect.height, vw / vh);
  }
  for (const invalid of [[0, 480, 1280, 720], [640, NaN, 1280, 720], [640, 480, Infinity, 720]]) {
    assert.equal(containRect(...invalid), null);
  }
});

test('broadcast maps the full camera into the fixed output regardless of host shape', () => {
  const landscape = broadcastLayout(640, 480, 1280, 720);
  const portrait = broadcastLayout(640, 480, 360, 800);
  assert.deepEqual(landscape.target, {x: 160, y: 0, width: 960, height: 720});
  assert.deepEqual(portrait.target, landscape.target);
  assert.deepEqual(portrait.source, {x: 0, y: 265, width: 360, height: 270});
  assert.equal(broadcastLayout(640, 480, 0, 800), null);
});

test('renderer crop preserves mirrored camera landmark alignment at DPR 1 and 2', () => {
  const videoWidth = 1920;
  const videoHeight = 1080;
  const mirroredVideoX = 0.73;
  const expectedOutputX = 1 - mirroredVideoX;

  for (const [hostWidth, hostHeight, dpr] of [[1280, 720, 1], [390, 844, 2], [1024, 500, 2]]) {
    const layout = broadcastLayout(videoWidth, videoHeight, hostWidth, hostHeight);
    const backingWidth = hostWidth * dpr;
    const backingHeight = hostHeight * dpr;
    const sourcePointX = (layout.source.x + (1 - mirroredVideoX) * layout.source.width) * backingWidth / hostWidth;
    const sourcePointY = (layout.source.y + 0.42 * layout.source.height) * backingHeight / hostHeight;
    const cropX = layout.source.x * backingWidth / hostWidth;
    const cropY = layout.source.y * backingHeight / hostHeight;
    const cropWidth = layout.source.width * backingWidth / hostWidth;
    const cropHeight = layout.source.height * backingHeight / hostHeight;
    const mappedX = (sourcePointX - cropX) / cropWidth;
    const mappedY = (sourcePointY - cropY) / cropHeight;
    near(mappedX, expectedOutputX);
    near(mappedY, 0.42);
    near((layout.target.x + mappedX * layout.target.width - layout.target.x) / layout.target.width, expectedOutputX);
    near((layout.target.y + mappedY * layout.target.height - layout.target.y) / layout.target.height, 0.42);
  }
});

test('camera home keeps the baseline body inside its source frame with margin', () => {
  for (const [videoWidth, videoHeight, hostWidth, hostHeight] of [
    [640, 480, 1280, 720],
    [1920, 1080, 390, 844],
    [1080, 1920, 1400, 700],
  ]) {
    const home = cameraHome(videoWidth, videoHeight, hostWidth, hostHeight);
    assert.ok(home);
    const {x, y, scale, frame} = home;
    const bodyLeft = x + hostWidth / 2 - 1.12 * scale;
    const bodyRight = x + hostWidth / 2 + 1.12 * scale;
    const bodyBottom = hostHeight / 2 - y;
    const bodyTop = bodyBottom - 1.46 * scale;
    assert.ok(bodyLeft >= frame.x + frame.width * 0.02);
    assert.ok(bodyRight <= frame.x + frame.width - frame.width * 0.02);
    near(bodyBottom, frame.y + frame.height - frame.width * 0.03);
    assert.ok(bodyTop > frame.y);
    near(scale, frame.width * 0.16 / 2.24);
  }
  assert.equal(cameraHome(0, 480, 1280, 720), null);
});

test('broadcast home position and size remain constant when the controller is resized', () => {
  for (const [vw,vh] of [[640,480],[1920,1080],[1080,1920]]) {
    const projected=[];
    for (const [width,height] of [[360,800],[1600,410],[600,340]]) {
      const pose=cameraHome(vw,vh,width,height),{source,target}=broadcastLayout(vw,vh,width,height);
      projected.push({
        x:target.x+(pose.x+width/2-source.x)/source.width*target.width,
        y:target.y+(height/2-pose.y-source.y)/source.height*target.height,
        bodyWidth:pose.scale*2.24/source.width*target.width,
      });
    }
    for (const value of projected.slice(1))for(const key of ['x','y','bodyWidth'])near(value[key],projected[0][key]);
  }
});
