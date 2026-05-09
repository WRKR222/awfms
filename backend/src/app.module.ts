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
import { FlockModule }    from './modules/flock/flock.module';
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
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({ wildcard: false, delimiter: '.', global: true }),

    PrismaModule,
    NotificationsModule,

    AuthModule,
    FlockModule,      // batches, daily entries, culling — required by Production Manager
    FeedModule,
    HealthModule,
    SalesModule,
    DashboardModule,
    ProductionModule,
    StoreModule,
    PricingModule,
    BookingsModule,
    DeliveryModule,
    FinanceModule,
    AiModule,
    EventsModule,
    VisitorsModule,
  ],
})
export class AppModule {}
