import { Module } from '@nestjs/common';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { CageMapController } from './cage-map.controller';
import { CageMapService } from './cage-map.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ProductionController, CageMapController],
  providers: [ProductionService, CageMapService],
  exports: [ProductionService, CageMapService],
})
export class ProductionModule {}
