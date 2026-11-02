import test from 'node:test';
import assert from 'node:assert/strict';
import { InteractionLoop } from '../public/interaction.js';

const advance = (loop, at, options) => loop.update(at, options);

test('virtual snack advances through all phases and restores the selected baseline', () => {
  const loop = new InteractionLoop();
  loop.setBaseline('amused');
  const { id } = loop.request('snack', 1000);
  assert.equal(loop.snapshot.phase, 'notice');
  assert.equal(loop.snapshot.mood, 'curious');
  assert.equal(advance(loop, 1400).phase, 'hopping');
  assert.equal(advance(loop, 1850).phase, 'landing');
  assert.equal(advance(loop, 2100).phase, 'feeding');
  assert.equal(loop.snapshot.mood, 'content');
  assert.equal(advance(loop, 3300).phase, 'celebrating');
  assert.equal(loop.snapshot.mood, 'delighted');
  assert.equal(advance(loop, 4100).phase, 'returning');
  const end = advance(loop, 4800);
  assert.equal(end.phase, 'idle');
  assert.equal(end.mood, 'amused');
  assert.deepEqual(end.lastResult, { id, kind: 'snack', outcome: 'completed' });
  assert.deepEqual(advance(loop, 9000).lastResult, end.lastResult);
});

test('real palm snack waits, starts hopping only when seen, and expires after 15 seconds', () => {
  const loop = new InteractionLoop();
  loop.request('snack', 0, { requirePalm: true });
  assert.equal(advance(loop, 400).phase, 'waitingHand');
  assert.equal(advance(loop, 15399).phase, 'waitingHand');
  assert.equal(advance(loop, 15400).phase, 'idle');
  assert.equal(loop.snapshot.lastResult.outcome, 'expired');

  loop.reset(20000);
  loop.request('snack', 20000, { requirePalm: true });
  assert.equal(advance(loop, 20400).phase, 'waitingHand');
  assert.equal(advance(loop, 21000, { palmAvailable: true }).phase, 'hopping');
  assert.equal(loop.snapshot.phaseAge, 0);
  advance(loop, 25600, { palmAvailable: true });
  assert.equal(loop.snapshot.phase, 'idle');
  assert.equal(loop.snapshot.lastResult.outcome, 'completed');
});

test('tracking loss returns once and never replays feeding after reacquisition', () => {
  const loop = new InteractionLoop();
  const { id } = loop.request('snack', 0, { requirePalm: true });
  advance(loop, 400);
  advance(loop, 500, { palmAvailable: true });
  advance(loop, 950, { palmAvailable: true });
  advance(loop, 1200, { palmAvailable: true });
  assert.equal(loop.snapshot.phase, 'feeding');
  assert.equal(advance(loop, 1300).phase, 'returning');
  assert.equal(loop.snapshot.lastResult, null);
  assert.equal(advance(loop, 2000, { palmAvailable: true }).phase, 'idle');
  assert.deepEqual(loop.snapshot.lastResult, { id, kind: 'snack', outcome: 'tracking-lost' });
});

test('surprise ignores palm state and completes its reveal sequence', () => {
  const loop = new InteractionLoop();
  const { id } = loop.request('surprise', 10, { requirePalm: true });
  assert.equal(loop.snapshot.phase, 'hiding');
  assert.equal(advance(loop, 610).phase, 'anticipating');
  assert.equal(advance(loop, 910).phase, 'hopping');
  assert.equal(advance(loop, 1360).phase, 'revealing');
  assert.equal(loop.snapshot.mood, 'surprised');
  assert.equal(advance(loop, 2060).phase, 'settling');
  assert.equal(advance(loop, 2560).phase, 'returning');
  assert.equal(advance(loop, 3260).lastResult.outcome, 'completed');
  assert.deepEqual(loop.snapshot.lastResult, { id, kind: 'surprise', outcome: 'completed' });
});

test('cheer bursts queue and merge once behind a snack', () => {
  const loop = new InteractionLoop();
  loop.request('snack', 0);
  const queued = loop.request('cheer', 100);
  assert.equal(queued.accepted, true);
  assert.equal(loop.snapshot.pendingCheer, true);
  assert.equal(loop.request('cheer', 200).id, queued.id);
  advance(loop, 3900);
  assert.equal(loop.snapshot.kind, 'cheer');
  assert.equal(loop.snapshot.pendingCheer, false);
  assert.equal(loop.request('cheer', 4000).reason, 'merged');
  advance(loop, 4700);
  assert.deepEqual(loop.snapshot.lastResult, { id: queued.id, kind: 'cheer', outcome: 'completed' });
});

test('pause and quiet cancel actions, take precedence, and never replay old input', () => {
  const loop = new InteractionLoop();
  const action = loop.request('surprise', 0);
  loop.request('cheer', 100);
  const paused = loop.setPaused(true, 200);
  assert.equal(paused.phase, 'idle');
  assert.equal(paused.mood, 'sleepy');
  assert.equal(paused.pendingCheer, false);
  assert.deepEqual(paused.lastResult, { id: action.id, kind: 'surprise', outcome: 'cancelled' });
  assert.equal(loop.request('cheer', 300).reason, 'paused');
  loop.setQuiet(true, 400);
  assert.equal(loop.snapshot.mood, 'sleepy');
  loop.setPaused(false, 500);
  assert.equal(loop.snapshot.mood, 'content');
  assert.equal(loop.snapshot.phase, 'idle');
  assert.equal(loop.request('snack', 600).reason, 'quiet');
  loop.setQuiet(false, 700);
  assert.equal(loop.snapshot.mood, 'content');
  assert.equal(loop.snapshot.phase, 'idle');
});

test('dismiss records its outcome, clears queued cheer, and reset restores defaults', () => {
  const loop = new InteractionLoop();
  const action = loop.request('snack', 100);
  loop.request('cheer', 200);
  loop.dismiss(300);
  assert.equal(loop.snapshot.phase, 'idle');
  assert.equal(loop.snapshot.pendingCheer, false);
  assert.deepEqual(loop.snapshot.lastResult, { id: action.id, kind: 'snack', outcome: 'dismissed' });
  loop.setBaseline('curious');
  loop.setQuiet(true, 400);
  loop.reset(500);
  assert.deepEqual(loop.snapshot, {
    phase: 'idle', kind: null, active: false, phaseAge: 0, phaseProgress: 0,
    mood: 'content', baseline: 'content', paused: false, quiet: false,
    pendingCheer: false, lastResult: null,
  });
});

test('large jumps finish every finite phase and retain exactly one terminal result', () => {
  const loop = new InteractionLoop();
  const { id } = loop.request('surprise', 0);
  const done = advance(loop, 100000);
  assert.equal(done.phase, 'idle');
  assert.deepEqual(done.lastResult, { id, kind: 'surprise', outcome: 'completed' });
  advance(loop, 200000);
  assert.deepEqual(loop.snapshot.lastResult, done.lastResult);
});

test('backward request timestamps use the current loop time and reset may intentionally rewind', () => {
  const loop = new InteractionLoop();
  loop.update(10000);
  loop.request('snack', 0);
  assert.equal(loop.snapshot.phase, 'notice');
  assert.equal(loop.snapshot.phaseAge, 0);
  assert.equal(advance(loop, 10400).phase, 'hopping');

  loop.reset(50000);
  loop.reset(0);
  loop.request('snack', 0);
  assert.equal(loop.snapshot.phase, 'notice');
  assert.equal(advance(loop, 400).phase, 'hopping');
});

test('pause during palm wait and quiet during palm feeding cancel queued cheer', () => {
  const waiting = new InteractionLoop();
  const waitingSnack = waiting.request('snack', 0, { requirePalm: true });
  advance(waiting, 400);
  waiting.request('cheer', 500);
  const paused = waiting.setPaused(true, 600);
  assert.equal(paused.phase, 'idle');
  assert.equal(paused.pendingCheer, false);
  assert.equal(paused.mood, 'sleepy');
  assert.deepEqual(paused.lastResult, {
    id: waitingSnack.id, kind: 'snack', outcome: 'cancelled',
  });

  const feeding = new InteractionLoop();
  const feedingSnack = feeding.request('snack', 0, { requirePalm: true });
  advance(feeding, 400);
  advance(feeding, 500, { palmAvailable: true });
  advance(feeding, 950, { palmAvailable: true });
  advance(feeding, 1200, { palmAvailable: true });
  assert.equal(feeding.snapshot.phase, 'feeding');
  feeding.request('cheer', 1250);
  const quiet = feeding.setQuiet(true, 1300);
  assert.equal(quiet.phase, 'idle');
  assert.equal(quiet.pendingCheer, false);
  assert.equal(quiet.mood, 'content');
  assert.deepEqual(quiet.lastResult, {
    id: feedingSnack.id, kind: 'snack', outcome: 'cancelled',
  });
});

test('pending cheer starts after palm timeout or tracking-loss return', () => {
  const expired = new InteractionLoop();
  expired.request('snack', 0, { requirePalm: true });
  advance(expired, 400);
  const expiredCheer = expired.request('cheer', 500);
  advance(expired, 15400);
  assert.equal(expired.snapshot.kind, 'cheer');
  assert.equal(expired.snapshot.lastResult.outcome, 'expired');
  advance(expired, 16300);
  assert.deepEqual(expired.snapshot.lastResult, {
    id: expiredCheer.id, kind: 'cheer', outcome: 'completed',
  });

  const lost = new InteractionLoop();
  const lostSnack = lost.request('snack', 0, { requirePalm: true });
  advance(lost, 400);
  advance(lost, 500, { palmAvailable: true });
  lost.request('cheer', 600);
  advance(lost, 700);
  assert.equal(lost.snapshot.phase, 'returning');
  advance(lost, 1400, { palmAvailable: true });
  assert.equal(lost.snapshot.kind, 'cheer');
  assert.deepEqual(lost.snapshot.lastResult, {
    id: lostSnack.id, kind: 'snack', outcome: 'tracking-lost',
  });
});

test('validates all eight baseline moods', () => {
  const loop = new InteractionLoop();
  for (const mood of ['content', 'curious', 'anticipation', 'delighted', 'amused', 'surprised', 'concerned', 'sleepy']) {
    assert.equal(loop.setBaseline(mood).baseline, mood);
  }
  assert.throws(() => loop.setBaseline('sad'), RangeError);
});

test('ordinary chat text is not an interaction or a mood trigger', () => {
  const loop = new InteractionLoop();
  loop.setBaseline('curious');
  for (const text of ['LOL', 'I am sad', 'PogChamp', '', '!unknown']) {
    const result = loop.request(text, 0);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'invalid-kind');
    assert.equal(loop.snapshot.phase, 'idle');
    assert.equal(loop.snapshot.mood, 'curious');
  }
});
