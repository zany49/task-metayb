/**
 * The application's clock. Everything time-based in the dispatch workflow (job timestamps,
 * history events, deadlines and, later, the 2-hour confirmation timeout) reads the time from
 * here instead of calling Date.now() directly.
 *
 * That makes time "movable": a reviewer can advance the clock by 2 hours to see a timeout
 * happen without waiting, and tests can do the same. In normal use the offset is 0, so the
 * clock is simply the real time.
 *
 * The offset lives in memory, so restarting the server resets it to real time.
 */
let offsetMs = 0;

export const clock = {
  /** Current (possibly simulated) time. */
  now() {
    return new Date(Date.now() + offsetMs);
  },

  /** Moves the clock forward, e.g. clock.advance(2 * 60 * 60 * 1000) for 2 hours. */
  advance(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('The clock can only move forward');
    offsetMs += ms;
    return this.now();
  },

  /** Back to real time. */
  reset() {
    offsetMs = 0;
  },

  /** How far ahead of real time the clock is, in milliseconds. */
  offsetMs() {
    return offsetMs;
  },
};
