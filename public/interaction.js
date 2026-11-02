const BASELINES = new Set([
  'content', 'curious', 'anticipation', 'delighted',
  'amused', 'surprised', 'concerned', 'sleepy',
]);

const DURATIONS = {
  snack: {
    notice: 0.4, hopping: 0.45, landing: 0.25, feeding: 1.2,
    celebrating: 0.8, returning: 0.7,
  },
  surprise: {
    hiding: 0.6, anticipating: 0.3, hopping: 0.45,
    revealing: 0.7, settling: 0.5, returning: 0.7,
  },
  cheer: { cheering: 0.9 },
};

const NEXT = {
  snack: {
    notice: 'waitingHand', waitingHand: 'hopping', hopping: 'landing',
    landing: 'feeding', feeding: 'celebrating', celebrating: 'returning',
    returning: null,
  },
  surprise: {
    hiding: 'anticipating', anticipating: 'hopping', hopping: 'revealing',
    revealing: 'settling', settling: 'returning', returning: null,
  },
  cheer: { cheering: null },
};

const WAIT_SECONDS = 15;

/** Deterministic interaction timing and mood state, driven only by caller time. */
export class InteractionLoop {
  constructor() {
    this._nextId = 1;
    this.reset(0);
  }

  request(kind, nowMs, { requirePalm = false } = {}) {
    this.update(nowMs, { palmAvailable: this._palmAvailable });
    if (!['snack', 'surprise', 'cheer'].includes(kind)) {
      return { accepted: false, reason: 'invalid-kind' };
    }
    if (this.paused) return { accepted: false, reason: 'paused' };
    if (this.quiet) return { accepted: false, reason: 'quiet' };

    if (kind === 'cheer' && this.active) {
      if (this.kind === 'cheer') return { accepted: true, reason: 'merged', id: this.id };
      if (!this.pendingCheer) this.pendingCheerId = this._nextId++;
      this.pendingCheer = true;
      return { accepted: true, reason: 'queued', id: this.pendingCheerId };
    }
    if (this.active) return { accepted: false, reason: 'busy' };

    const id = this._nextId++;
    this._start(kind, id, this._lastNow, kind === 'snack' && requirePalm);
    return { accepted: true, reason: 'accepted', id };
  }

  update(nowMs, { palmAvailable = false } = {}) {
    if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
    if (nowMs < this._lastNow) nowMs = this._lastNow;
    this._lastNow = nowMs;
    this._palmAvailable = Boolean(palmAvailable);

    if (this.paused || this.quiet) return this.snapshot;

    // A finite transition loop consumes arbitrarily large timestamp jumps.
    for (let transitions = 0; transitions < 32 && this.active; transitions++) {
      if (this.kind === 'snack' && this.phase === 'waitingHand') {
        if (nowMs - this.phaseStart >= WAIT_SECONDS * 1000) {
          this._finish('expired', this.phaseStart + WAIT_SECONDS * 1000);
          continue;
        }
        if (palmAvailable) {
          this._enter('hopping', nowMs);
          continue;
        }
        break;
      }

      if (this._needsPalm && ['hopping', 'landing', 'feeding', 'celebrating'].includes(this.phase) && !palmAvailable) {
        this._enter('returning', nowMs, 'tracking-lost');
        // Returning begins at loss time and must not be fast-forwarded through
        // using time that elapsed before tracking was known to be absent.
        break;
      }

      const end = this.phaseStart + this.phaseDuration * 1000;
      if (nowMs < end) break;
      const next = NEXT[this.kind][this.phase];
      if (next === null) {
        this._finish('completed', end);
        continue;
      }
      if (this.kind === 'snack' && this.phase === 'notice' && next === 'waitingHand' && !this._needsPalm) {
        this._enter('hopping', end);
        continue;
      }
      this._enter(next, end);
    }
    return this.snapshot;
  }

  setPaused(value, nowMs) {
    this.update(nowMs, { palmAvailable: this._palmAvailable });
    this.paused = Boolean(value);
    if (this.paused) {
      this._cancel('cancelled', this._lastNow);
      this._clearPending();
    }
    return this.update(nowMs);
  }

  setQuiet(value, nowMs) {
    this.update(nowMs, { palmAvailable: this._palmAvailable });
    this.quiet = Boolean(value);
    if (this.quiet) {
      this._cancel('cancelled', this._lastNow);
      this._clearPending();
    }
    return this.update(nowMs);
  }

  setBaseline(mood) {
    if (!BASELINES.has(mood)) throw new RangeError(`Unknown baseline mood: ${mood}`);
    this.baseline = mood;
    return this.snapshot;
  }

  dismiss(nowMs) {
    this.update(nowMs, { palmAvailable: this._palmAvailable });
    this._cancel('dismissed', this._lastNow);
    this._clearPending();
    return this.update(nowMs);
  }

  reset(nowMs = this._lastNow ?? 0) {
    if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
    this.phase = 'idle';
    this.kind = null;
    this.id = null;
    this.phaseStart = nowMs;
    this.phaseDuration = 0;
    this._lastNow = nowMs;
    this._needsPalm = false;
    this._palmAvailable = false;
    this._terminalOutcome = null;
    this.pendingCheer = false;
    this.pendingCheerId = null;
    this.paused = false;
    this.quiet = false;
    this.baseline = 'content';
    this.lastResult = null;
    return this.snapshot;
  }

  get snapshot() {
    const duration = this.phaseDuration * 1000;
    const ageMs = this.phase === 'idle' ? 0 : Math.max(0, this._lastNow - this.phaseStart);
    const progress = duration > 0 ? Math.min(1, ageMs / duration) : 0;
    return {
      phase: this.phase,
      kind: this.kind,
      active: this.phase !== 'idle',
      phaseAge: ageMs / 1000,
      phaseProgress: progress,
      mood: this._mood(),
      baseline: this.baseline,
      paused: this.paused,
      quiet: this.quiet,
      pendingCheer: this.pendingCheer,
      lastResult: this.lastResult ? { ...this.lastResult } : null,
    };
  }

  get active() {
    return this.phase !== 'idle';
  }

  _mood() {
    if (this.paused) return 'sleepy';
    if (this.quiet) return 'content';
    if (!this.active) return this.baseline;
    if (this.kind === 'cheer') return 'delighted';
    if (this.kind === 'snack') {
      if (this.phase === 'notice') return 'curious';
      if (['waitingHand', 'hopping', 'landing'].includes(this.phase)) return 'anticipation';
      if (this.phase === 'feeding') return 'content';
      if (this.phase === 'celebrating') return 'delighted';
    }
    if (this.kind === 'surprise') {
      if (['hiding', 'anticipating', 'hopping'].includes(this.phase)) return 'anticipation';
      if (this.phase === 'revealing') return 'surprised';
      if (this.phase === 'settling') return 'delighted';
    }
    return this.baseline;
  }

  _start(kind, id, at, needsPalm = false) {
    this.kind = kind;
    this.id = id;
    this._needsPalm = needsPalm;
    const initial = kind === 'snack' ? 'notice' : kind === 'surprise' ? 'hiding' : 'cheering';
    this._enter(initial, at);
  }

  _enter(phase, at, outcome = null) {
    this.phase = phase;
    this.phaseStart = at;
    this.phaseDuration = phase === 'waitingHand' ? WAIT_SECONDS : DURATIONS[this.kind][phase];
    if (outcome) this._terminalOutcome = outcome;
  }

  _finish(outcome, at) {
    const result = { id: this.id, kind: this.kind, outcome: this._terminalOutcome || outcome };
    this._setOutcome(outcome, result);
    this.phase = 'idle';
    this.kind = null;
    this.id = null;
    this.phaseStart = at;
    this.phaseDuration = 0;
    this._needsPalm = false;
    this._terminalOutcome = null;
    if (this.pendingCheer && !this.paused && !this.quiet) {
      const cheerId = this.pendingCheerId;
      this._clearPending();
      this._start('cheer', cheerId, at);
    }
  }

  _setOutcome(outcome, knownResult = null) {
    this.lastResult = knownResult || { id: this.id, kind: this.kind, outcome };
  }

  _cancel(outcome, at) {
    if (!this.active) return;
    this.lastResult = { id: this.id, kind: this.kind, outcome };
    this.phase = 'idle';
    this.kind = null;
    this.id = null;
    this.phaseStart = at;
    this.phaseDuration = 0;
    this._needsPalm = false;
    this._terminalOutcome = null;
  }

  _clearPending() {
    this.pendingCheer = false;
    this.pendingCheerId = null;
  }
}
