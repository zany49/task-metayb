/**
 * Resets the demo data and loads it again. Run with: npm run seed
 *
 * Riders and jobs are created, and some jobs moved through the workflow, using the same services
 * the API uses. So seeded data follows exactly the same rules, and leaves the same history and
 * capacity reservations, as data created through the app. Nothing is written "by hand".
 */
import mongoose from 'mongoose';
import { env, isProduction } from '../config/env.js';
import { connectDb, connectionHint, disconnectDb } from '../db/connect.js';
import { SYSTEM_ACTOR } from '../domain/actor.js';
import { Assignment } from '../models/assignment.model.js';
import { Job } from '../models/job.model.js';
import { JobEvent } from '../models/jobEvent.model.js';
import { OtpChallenge } from '../models/otpChallenge.model.js';
import { Rider } from '../models/rider.model.js';
import { Setting } from '../models/setting.model.js';
import { User } from '../models/user.model.js';
import { CreateJobSchema } from '../schemas/job.schemas.js';
import { CreateRiderSchema } from '../schemas/rider.schemas.js';
import { assignRider, markDelivered, markPickedUp, respondToAssignment } from '../services/dispatch.service.js';
import { cancelJob, createJob } from '../services/job.service.js';
import { getRecommendations } from '../services/recommendation.service.js';
import { createRider } from '../services/rider.service.js';

const DISPATCHERS = [
  { name: 'Priya Raman', mobile: '9000000001' },
  { name: 'Arjun Mehta', mobile: '9000000002' },
];

const RIDERS = [
  { name: 'Ravi Kumar', mobile: '9100000001', zones: ['CENTRAL', 'NORTH'], capacity: 10, maxActiveJobs: 3, currentZone: 'CENTRAL', availability: 'AVAILABLE' },
  { name: 'Karthik Srinivasan', mobile: '9100000002', zones: ['CENTRAL', 'SOUTH', 'EAST'], capacity: 8, maxActiveJobs: 3, currentZone: 'SOUTH', availability: 'AVAILABLE' },
  { name: 'Meena Lakshmi', mobile: '9100000003', zones: ['NORTH', 'EAST'], capacity: 6, maxActiveJobs: 2, currentZone: 'NORTH', availability: 'AVAILABLE' },
  { name: 'Suresh Babu', mobile: '9100000004', zones: ['WEST', 'CENTRAL'], capacity: 12, maxActiveJobs: 4, currentZone: 'WEST', availability: 'AVAILABLE' },
  { name: 'Anitha Devi', mobile: '9100000005', zones: ['SOUTH', 'WEST'], capacity: 5, maxActiveJobs: 2, currentZone: 'SOUTH', availability: 'ON_BREAK' },
  { name: 'Vijay Anand', mobile: '9100000006', zones: ['EAST', 'CENTRAL'], capacity: 15, maxActiveJobs: 3, currentZone: 'EAST', availability: 'OFF_DUTY' },
  { name: 'Farhan Ali', mobile: '9100000007', zones: ['NORTH', 'CENTRAL', 'WEST'], capacity: 4, maxActiveJobs: 2, currentZone: 'CENTRAL', availability: 'AVAILABLE' },
  { name: 'Deepa Rajan', mobile: '9100000008', zones: ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST'], capacity: 10, maxActiveJobs: 3, currentZone: 'EAST', availability: 'AVAILABLE' },
];

const MINUTE = 60_000;
/** Deadline N minutes from now, as the API would receive it. */
const inMinutes = (minutes) => new Date(Date.now() + minutes * MINUTE).toISOString();

const JOBS = [
  { orderRef: 'ORD-1001', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3, priority: 'NORMAL', deadline: inMinutes(120) },
  { orderRef: 'ORD-1002', pickupZone: 'SOUTH', dropZone: 'CENTRAL', load: 5, priority: 'HIGH', deadline: inMinutes(90) },
  { orderRef: 'ORD-1003', pickupZone: 'EAST', dropZone: 'EAST', load: 2, priority: 'LOW' },
  { orderRef: 'ORD-1004', pickupZone: 'NORTH', dropZone: 'EAST', load: 4, priority: 'URGENT', deadline: inMinutes(45), notes: 'Medical supplies, deliver first' },
  { orderRef: 'ORD-1005', pickupZone: 'WEST', dropZone: 'CENTRAL', load: 8, priority: 'NORMAL', deadline: inMinutes(180) },
  { orderRef: 'ORD-1006', pickupZone: 'CENTRAL', dropZone: 'SOUTH', load: 6, priority: 'HIGH', deadline: inMinutes(120), notes: 'Fragile, handle with care' },
  { orderRef: 'ORD-1007', pickupZone: 'SOUTH', dropZone: 'WEST', load: 3, priority: 'NORMAL' },
  { orderRef: 'ORD-1008', pickupZone: 'NORTH', dropZone: 'WEST', load: 2, priority: 'LOW', deadline: inMinutes(300) },
  { orderRef: 'ORD-1009', pickupZone: 'EAST', dropZone: 'CENTRAL', load: 10, priority: 'HIGH', deadline: inMinutes(120) },
  // Bigger than any rider can carry: shows the "no eligible rider" case once recommendations exist.
  { orderRef: 'ORD-1010', pickupZone: 'CENTRAL', dropZone: 'EAST', load: 20, priority: 'URGENT', deadline: inMinutes(60), notes: 'Bulk order, needs a large carrier' },
];

async function seed() {
  if (isProduction) throw new Error('Refusing to reset the database in production');

  await connectDb(env.MONGODB_URI, env.MONGODB_DB);
  console.log(`Connected. Resetting demo data in database "${mongoose.connection.name}"...`);

  // Empty each collection rather than dropping the whole database: an Atlas user with the
  // default "read and write" role is not allowed to drop databases.
  // (collection.deleteMany talks to MongoDB directly; job history is append-only inside the app.)
  for (const model of [User, Rider, OtpChallenge, Job, JobEvent, Assignment, Setting]) {
    await model.createCollection(); // no-op if it already exists
    await model.collection.deleteMany({});
    await model.syncIndexes();
  }

  const dispatchers = await User.insertMany(DISPATCHERS.map((d) => ({ ...d, role: 'DISPATCHER' })));
  for (const rider of RIDERS) {
    // Same validation the API applies to a dispatcher's "add rider" request
    await createRider(CreateRiderSchema.parse(rider), SYSTEM_ACTOR);
  }

  // Jobs are entered by Priya, the first dispatcher, so the history shows a real person.
  const priya = { type: 'DISPATCHER', id: String(dispatchers[0]._id), name: dispatchers[0].name };
  const arjun = { type: 'DISPATCHER', id: String(dispatchers[1]._id), name: dispatchers[1].name };
  for (const job of JOBS) {
    await createJob(CreateJobSchema.parse(job), priya);
  }

  // Move some jobs along the workflow, always picking the top recommended rider,
  // so the dashboard shows every stage. Riders act as themselves.
  const riderDocs = await Rider.find().populate('userId', 'name').lean();
  const riderActor = (riderId) => {
    const r = riderDocs.find((doc) => String(doc._id) === riderId);
    return { type: 'RIDER', id: String(r.userId._id), name: r.userId.name, riderId };
  };
  const assignTop = async (orderRef) => {
    const { recommended } = await getRecommendations(orderRef);
    return assignRider(orderRef, { riderId: recommended[0].riderId }, priya);
  };
  const accept = ({ assignment }) => respondToAssignment(assignment.id, { accept: true }, riderActor(assignment.riderId));

  const delivered = await assignTop('ORD-1007');
  await accept(delivered);
  await markPickedUp('ORD-1007', riderActor(delivered.assignment.riderId));
  await markDelivered('ORD-1007', riderActor(delivered.assignment.riderId));

  const onTheWay = await assignTop('ORD-1005');
  await accept(onTheWay);
  await markPickedUp('ORD-1005', riderActor(onTheWay.assignment.riderId));

  await accept(await assignTop('ORD-1003'));
  await assignTop('ORD-1002'); // waiting for the rider to confirm
  await cancelJob('ORD-1008', 'Customer cancelled the order', arjun);

  console.log(`\nSeeded ${DISPATCHERS.length} dispatchers, ${RIDERS.length} riders and ${JOBS.length} jobs.`);
  console.log(`\nDemo logins (OTP for everyone: ${env.STATIC_OTP})`);
  console.table([
    ...DISPATCHERS.map((d) => ({ role: 'DISPATCHER', name: d.name, mobile: d.mobile, availability: '-' })),
    ...RIDERS.map((r) => ({ role: 'RIDER', name: r.name, mobile: r.mobile, availability: r.availability })),
  ]);
  console.log('\nJobs');
  const jobs = await Job.find().sort({ orderRef: 1 }).lean();
  console.table(
    jobs.map((j) => ({
      orderRef: j.orderRef,
      route: `${j.pickupZone} -> ${j.dropZone}`,
      load: j.load,
      priority: j.priority,
      status: j.status,
      rider: j.riderName ?? '-',
    })),
  );
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    const hint = connectionHint(err);
    if (hint) console.error(`Hint: ${hint}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
