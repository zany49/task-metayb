/**
 * The server has an app clock that can run ahead of real time (for timeout demos).
 * Relative times ("in 20 min", "12 min late") must be measured against that clock, so we
 * remember how far the server's clock is from this browser's clock.
 */
let serverOffsetMs = 0;

/** Call with any server timestamp that reflects the app clock (e.g. /meta serverTime). */
export function syncServerTime(serverIso) {
  const serverMs = new Date(serverIso).getTime();
  if (Number.isFinite(serverMs)) serverOffsetMs = serverMs - Date.now();
}

/** "Now" according to the server's app clock. */
export function serverNow() {
  return new Date(Date.now() + serverOffsetMs);
}
