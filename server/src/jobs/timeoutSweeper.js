/**
 * Confirmation timeout sweeper. Every few seconds it expires assignments whose confirmation
 * time is up (job -> Manual Queue, capacity released, history written).
 *
 * Why a polling sweeper:
 *   - All state lives in MongoDB (each assignment stores its own expiresAt), so nothing is lost
 *     if the server restarts: the next sweep picks up whatever became due while it was down.
 *   - A MongoDB TTL index only deletes documents; it cannot run business logic.
 *   - A job queue (BullMQ, Agenda) would add Redis or another moving part this app does not need.
 *   - Each expiry is a conditional update inside a transaction, so running two sweepers (e.g. two
 *     server instances) or racing a rider's "accept" can never expire the same attempt twice.
 *
 * At worst a job moves to the Manual Queue one sweep interval late; and a rider who tries to
 * accept after the deadline but before the sweep is refused and the attempt is expired on the spot.
 */
import { expireOverdueAssignments } from '../services/dispatch.service.js';

export function startTimeoutSweeper({ intervalSeconds, log = console }) {
  let running = false;

  const tick = async () => {
    if (running) return; // never overlap with a slow previous run
    running = true;
    try {
      const { expired } = await expireOverdueAssignments();
      if (expired > 0) log.info?.(`Timeout sweeper: ${expired} assignment(s) expired and moved to the manual queue`);
    } catch (err) {
      log.error?.('Timeout sweeper failed:', err.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalSeconds * 1000);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runNow: tick };
}
