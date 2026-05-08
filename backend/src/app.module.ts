// src/app.module.ts  (REPLACE existing file)
import { Module } from '@nestjs/common';
import { SalesModule }    from './modules/sales/sales.module';
import { ConfigModule }   from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule }     from './auth/auth.module';
import { PrismaModule }   from './common/prisma/prisma.module';
import { NotificationsModule } from './common/notifications/notifications.module';
import { FeedModule }     from './modules/feed/feed.module';
import { HealthModule }   from './modules/health/health.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ProductionModule } from './modules/production/production.module';
import { StoreModule }    from './modules/store/store.module';
import { PricingModule }  from './modules/pricing/pricing.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { FinanceModule }  from './modules/finance/finance.module';
import { AiModule }       from './modules/ai/ai.module';
import { EventsModule }   from './modules/events/events.module';
import { VisitorsModule } from './modules/visitors/visitors.module';

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting — 100 requests per minute per IP
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    // Cron jobs (AI alerts, overdue invoice checks)
    ScheduleModule.forRoot(),

    // Internal event bus (decouples WS emission from services)
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', global: true }),

    // Core infrastructure
    PrismaModule,
    NotificationsModule,

    // Feature modules
    AuthModule,
    FeedModule,
    HealthModule,
    SalesModule,
    DashboardModule,
    ProductionModule,
    StoreModule,
    PricingModule,
    BookingsModule,
    DeliveryModule,
    FinanceModule,    // Phase 4 — invoices, AR, expenses, overdue cron
    AiModule,         // Phase 6 — AI reports, feed alerts, mortality alerts
    EventsModule,     // Phase 6 PW-02 — WebSocket gateway
    VisitorsModule,    // Phase 5 — security gate check-in/out
  ],
})
export class AppModule {}
