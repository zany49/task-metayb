import { useEffect, useState } from 'react';
import { serverNow } from './time.js';

/**
 * The server's current (app clock) time, refreshed every `intervalMs`, so countdowns such as
 * "54 min left to confirm" keep moving without refetching anything.
 */
export function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Minutes from `now` until `date` (negative when it has passed). */
export const minutesUntil = (date, now) => (new Date(date).getTime() - now.getTime()) / 60_000;
