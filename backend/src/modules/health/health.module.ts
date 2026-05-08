import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
