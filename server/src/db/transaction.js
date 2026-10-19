import mongoose from 'mongoose';

/**
 * Runs `fn(session)` inside a MongoDB transaction: either every write in it is committed, or none is.
 * Every query inside `fn` must pass `{ session }`, otherwise it runs outside the transaction.
 *
 * The driver retries automatically on transient errors (e.g. a write conflict with another
 * transaction), so `fn` must be safe to run more than once.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
