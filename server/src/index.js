import { env, simulationEnabled } from './config/env.js';
import { createApp } from './app.js';
import { connectDb, connectionHint, disconnectDb } from './db/connect.js';
import { startTimeoutSweeper } from './jobs/timeoutSweeper.js';

async function main() {
  await connectDb(env.MONGODB_URI, env.MONGODB_DB);
  console.log(`Connected to MongoDB (database "${env.MONGODB_DB}")`);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`RELAY API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    console.log(`Confirmation timeout check every ${env.SWEEP_INTERVAL_SECONDS}s; demo controls ${simulationEnabled ? 'on' : 'off'}`);
  });

  const sweeper = startTimeoutSweeper({ intervalSeconds: env.SWEEP_INTERVAL_SECONDS });
  sweeper.runNow(); // pick up anything that became due while the server was down

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    sweeper.stop();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start RELAY API:', err instanceof Error ? err.message : err);
  const hint = connectionHint(err);
  if (hint) console.error(`Hint: ${hint}`);
  process.exit(1);
});
