// src/modules/finance/finance.module.ts
import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FinanceController],
  providers: [FinanceService, FinanceExportService],
  exports: [FinanceService],
})
export class FinanceModule {}
