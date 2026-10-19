import 'dotenv/config';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * Gives a test file a real MongoDB that supports transactions, builds all indexes,
 * and wipes every collection before each test.
 *
 * Default: starts a temporary in-memory MongoDB (nothing to set up). The first run downloads
 * a MongoDB binary (~100 MB); later runs use the cache.
 *
 * Alternative: set TEST_MONGODB_URI in .env to an Atlas connection string. Tests then use the
 * separate "relay_test" database in that cluster (and wipe it), never your real data.
 */
export function useTestDb() {
  let replSet;

  beforeAll(async () => {
    let uri = process.env.TEST_MONGODB_URI;
    if (!uri) {
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
      uri = replSet.getUri();
    }
    await mongoose.connect(uri, { dbName: 'relay_test' });
    for (const name of mongoose.modelNames()) {
      const model = mongoose.model(name);
      await model.init();
      await model.syncIndexes();
    }
  });

  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });
}
