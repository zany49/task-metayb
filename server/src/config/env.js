import 'dotenv/config';
import { z } from 'zod';

/**
 * All configuration is read once from environment variables (.env), validated, and exported.
 * A bad or missing value stops the app at startup instead of causing odd behaviour later.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required: paste your MongoDB Atlas connection string into .env' })
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb+srv:// or mongodb://')
    .refine((uri) => !uri.includes('<password>') && !uri.includes('<user>'), {
      message: 'MONGODB_URI still contains a placeholder: replace <user>/<password> with your Atlas database user',
    }),
  MONGODB_DB: z.string().trim().min(1).default('relay'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is required (copy .env.example to .env)' })
    .min(16, 'JWT_SECRET must be at least 16 characters long'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  STATIC_OTP: z.string().regex(/^\d{4,6}$/, 'STATIC_OTP must be 4-6 digits').default('1234'),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  /** Minutes a rider has to accept an assignment (dispatchers can change it in the app). */
  CONFIRMATION_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(120),
  /** How often the server checks for assignments whose confirmation time is up. */
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(3600).default(15),
  /** Demo controls (move the app clock, run the timeout check now). Default: on, except in production. */
  ENABLE_SIMULATION: z.enum(['true', 'false']).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid configuration. Fix these in server/.env (see .env.example):\n${problems}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const simulationEnabled = env.ENABLE_SIMULATION ? env.ENABLE_SIMULATION === 'true' : !isProduction;
