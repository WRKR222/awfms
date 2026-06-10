import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { CageMapController } from './cage-map.controller';
import { CageMapService } from './cage-map.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';
import { TallyVerificationService } from '../store/tally-verification.service';

// FIX: Added missing import for TallyVerificationService (was listed as provider but never imported).
// FIX: Removed EventEmitterModule.forRoot() — EventEmitter is already registered globally in
//      AppModule; calling forRoot() again here created a second isolated emitter instance.

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ProductionController, CageMapController],
  providers: [ProductionService, CageMapService, TallyVerificationService],
  exports: [ProductionService, CageMapService],
})
export class ProductionModule {}
