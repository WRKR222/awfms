import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import { WeightModule } from '../weight/weight.module';
import { ProductionModule } from '../production/production.module';

@Module({
  imports: [PrismaModule, NotificationsModule, WeightModule, ProductionModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
