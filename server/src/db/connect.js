import mongoose from 'mongoose';

/**
 * Connects to MongoDB (Atlas) and checks that it supports transactions.
 * Transactions keep related writes consistent (users + riders now; jobs, assignments and
 * history events later). They need a replica set; every Atlas cluster is one, including the
 * free M0 tier. A plain local `mongod` is not, so we fail early with a clear message.
 *
 * @param {string} uri     connection string, e.g. mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/
 * @param {string} dbName  database inside the cluster, e.g. "relay"
 */
export async function connectDb(uri, dbName) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    await mongoose.disconnect();
    throw new Error(
      'This MongoDB server does not support transactions (it is not a replica set). ' +
        'Use a MongoDB Atlas connection string in MONGODB_URI (the free M0 cluster works).',
    );
  }

  // Wait until every collection and index exists before serving requests: the unique indexes
  // (one job per order reference, one live assignment per job, ...) are business rules.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/**
 * Turns the most common Atlas connection errors into a hint about what to fix.
 * Returns undefined when there is no specific advice.
 */
export function connectionHint(err) {
  const message = String(err?.message ?? err);

  if (/bad auth|authentication failed/i.test(message)) {
    return (
      'Wrong username or password in MONGODB_URI. Use a database user from Atlas -> Database Access ' +
      '(not your Atlas website login). If the password has special characters (@ : / ? # [ ] %), ' +
      'URL-encode them or choose a password without them.'
    );
  }
  if (/ENOTFOUND|querySrv|EBADNAME/i.test(message)) {
    return 'Cluster address not found. Copy the connection string again from Atlas -> Connect -> Drivers.';
  }
  if (/whitelist|IP that isn't|Server selection timed out|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    return (
      'Could not reach the cluster. In Atlas -> Network Access, add your current IP address ' +
      '(or 0.0.0.0/0 to allow any IP while testing), then try again.'
    );
  }
  return undefined;
}
