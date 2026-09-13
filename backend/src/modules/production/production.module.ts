import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { CageMapController, CageMapUtilController } from './cage-map.controller';
import { CageMapService } from './cage-map.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import { TallyVerificationService } from '../store/tally-verification.service';
import { StoreModule } from '../store/store.module';
import { HdpControlController } from './hdp-control.controller';
import { HdpControlService } from './hdp-control.service';
import { AiModule } from '../ai/ai.module';
import { EggCollectionMissedCron } from './egg-collection-missed.cron';

// FIX: Added missing import for TallyVerificationService (was listed as provider but never imported).
// FIX: Removed EventEmitterModule.forRoot() — EventEmitter is already registered globally in
//      AppModule; calling forRoot() again here created a second isolated emitter instance.
// FIX (broken/damaged + store-linked feed/vaccines): ProductionService now needs
//      StoreInventoryService to gate egg-collection feed/vaccine/supplement
//      logging against what Store actually issued — import StoreModule
//      (already exports StoreInventoryService) instead of duplicating its
//      provider graph here.

// FIX: imported AiModule so HdpControlService can inject AiService for the
// image-upload HDP% control reader (Claude vision) — AiModule already
// exports AiService for this exact cross-module pattern (FlockModule uses it too).
@Module({
  imports: [PrismaModule, NotificationsModule, StoreModule, AiModule],
  controllers: [ProductionController, CageMapController, CageMapUtilController, HdpControlController],
  providers: [ProductionService, CageMapService, TallyVerificationService, HdpControlService, EggCollectionMissedCron],
  exports: [ProductionService, CageMapService],
})
export class ProductionModule {}
