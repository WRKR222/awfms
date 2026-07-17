// src/modules/store/store.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreInventoryService } from './store-inventory.service';
import { StoreInventoryController } from './store-inventory.controller';
import { FarmHRService } from './farm-hr.service';
import { FarmHRController } from './farm-hr.controller';
import { TallyVerificationService } from './tally-verification.service';
import { TallyVerificationController } from './tally-verification.controller';
import { StockRequestService } from './stock-request.service';
import { StockRequestController } from './stock-request.controller';
import { IssuancePlanService } from './issuance-plan.service';
import { IssuancePlanController } from './issuance-plan.controller';
import { IssuancePlanCron } from './issuance-plan.cron';
import { PMRequisitionService } from './pm-requisition.service';
import { PMRequisitionController } from './pm-requisition.controller';
import { PMRequisitionCron } from './pm-requisition.cron';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [
    StoreService,
    StoreInventoryService,
    FarmHRService,
    TallyVerificationService,
    StockRequestService,
    IssuancePlanService,
    IssuancePlanCron,
    PMRequisitionService,
    PMRequisitionCron,
  ],
  controllers: [
    StoreController,
    StoreInventoryController,
    FarmHRController,
    TallyVerificationController,
    StockRequestController,
    IssuancePlanController,
    PMRequisitionController,
  ],
  exports: [StoreService, StoreInventoryService, TallyVerificationService, StockRequestService, IssuancePlanService, PMRequisitionService],
})
export class StoreModule {}
