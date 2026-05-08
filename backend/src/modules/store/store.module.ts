// src/modules/store/store.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StoreService } from './store.service';
import { StoreController } from './store.controller';
import { StoreInventoryService } from './store-inventory.service';
import { StoreInventoryController } from './store-inventory.controller';
import { StoreOperationsService } from './store-operations.service';
import { StoreOperationsController } from './store-operations.controller';
import { FarmHRService } from './farm-hr.service';
import { FarmHRController } from './farm-hr.controller';
import { TallyVerificationService } from './tally-verification.service';
import { TallyVerificationController } from './tally-verification.controller';
import { StockRequestService } from './stock-request.service';
import { StockRequestController } from './stock-request.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    StoreService,
    StoreInventoryService,
    StoreOperationsService,
    FarmHRService,
    TallyVerificationService,
    StockRequestService,
  ],
  controllers: [
    StoreController,
    StoreInventoryController,
    StoreOperationsController,
    FarmHRController,
    TallyVerificationController,
    StockRequestController,
  ],
  exports: [StoreService, TallyVerificationService, StockRequestService],
})
export class StoreModule {}
