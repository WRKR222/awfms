import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { z } from 'zod';

// ── Environment schema — validates ALL required env vars at startup ─────────
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  // Redis is a Railway-only concern — optional for local development
  REDIS_URL: z.string().optional().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().url(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-6'),
  // Optional override for the on-demand Director batch report only (AiService
  // .generateBatchReport). This report is the most data-dense one we produce —
  // it now pulls every brooder/health/vaccination data point for a batch, not
  // just eggs/feed/survival — so it benefits most from a higher-capability
  // model. Falls back to ANTHROPIC_MODEL if unset, so nothing breaks if this
  // var is never added. Deliberately kept separate from ANTHROPIC_MODEL so the
  // cheaper automated cron reports (weekly/improvement-suggestions) aren't
  // forced onto the pricier model too.
  ANTHROPIC_MODEL_BATCH_REPORT: z.string().optional(),
  FEED_ALERT_THRESHOLD_DAYS: z.coerce.number().default(3),
  MORTALITY_ALERT_PCT_ABOVE_AVG: z.coerce.number().default(15),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    result.error.issues.forEach(issue => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      validate: validateEnv,
      isGlobal: true,
    }),
  ],
})
export class AppConfigModule {}
