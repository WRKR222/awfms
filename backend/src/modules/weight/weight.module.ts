import { Module } from '@nestjs/common';
import { WeightController } from './weight.controller';
import { WeightAlertService } from './weight-alert.service';
import { BirdWeightReportService } from './bird-weight-report.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [WeightController],
  providers: [WeightAlertService, BirdWeightReportService],
  exports: [WeightAlertService, BirdWeightReportService],
})
export class WeightModule {}
