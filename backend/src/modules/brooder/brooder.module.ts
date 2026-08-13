// src/modules/brooder/brooder.module.ts
import { Module } from '@nestjs/common';
import { BrooderController } from './brooder.controller';
import { BrooderService } from './brooder.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StoreModule } from '../store/store.module';
import { FeedWastageModule } from '../../common/feed/feed-wastage.module';
// NotificationsModule is @Global() so its service is available without
// importing the module — but we import it explicitly here for clarity.

@Module({
  imports: [PrismaModule, StoreModule, FeedWastageModule],
  controllers: [BrooderController],
  providers: [BrooderService],
  exports: [BrooderService],
})
export class BrooderModule {}
