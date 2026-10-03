import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  ML_SERVICE_URL: z.string().url().optional(),
  ML_SERVICE_TIMEOUT_MS: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type EnvConfig = Omit<z.infer<typeof envSchema>, 'ML_SERVICE_URL'> & {
  ML_SERVICE_URL: string;
};

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[Config Error] Invalid environment configuration:', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

const mlServiceUrl = parsed.data.ML_SERVICE_URL ??
  (parsed.data.NODE_ENV === 'production' ? undefined : 'http://localhost:8000');

if (!mlServiceUrl) {
  throw new Error('ML_SERVICE_URL must be set in production');
}

const mlServiceHostname = new URL(mlServiceUrl).hostname.toLowerCase();
if (
  parsed.data.NODE_ENV === 'production' &&
  ['localhost', '127.0.0.1', '::1'].includes(mlServiceHostname)
) {
  throw new Error('ML_SERVICE_URL must not use localhost in production');
}

export const config: EnvConfig = {
  ...parsed.data,
  // Strip any trailing slashes from the ML service URL
  ML_SERVICE_URL: mlServiceUrl.replace(/\/+$/, ''),
};

// Alias so consumers can import { env } or { config } interchangeably
export const env = config;
