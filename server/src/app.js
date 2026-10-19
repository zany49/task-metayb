import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import assignmentRoutes from './routes/assignments.routes.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import jobRoutes from './routes/jobs.routes.js';
import metaRoutes from './routes/meta.routes.js';
import riderRoutes from './routes/riders.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import simulationRoutes from './routes/simulation.routes.js';

/**
 * Builds the Express app without starting a server or connecting to the database,
 * so tests can drive it directly with supertest.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }));
  app.use(express.json({ limit: '100kb' }));
  if (env.NODE_ENV === 'development') app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/riders', riderRoutes);
  app.use('/api/jobs', jobRoutes);
  app.use('/api/assignments', assignmentRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/simulation', simulationRoutes);
  app.use('/api/meta', metaRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
