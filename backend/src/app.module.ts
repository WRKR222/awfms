import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { FlockModule } from './modules/flock/flock.module';
import { FeedModule } from './modules/feed/feed.module';
import { HealthModule } from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting — 100 requests per minute per IP
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    // Cron jobs (AI alerts, overdue invoice checks)
    ScheduleModule.forRoot(),

    // Core infrastructure
    PrismaModule,
    NotificationsModule,

    // Feature modules
    AuthModule,
    FlockModule,
    FeedModule,
    HealthModule,
    DashboardModule,
  ],
})
export class AppModule {}
