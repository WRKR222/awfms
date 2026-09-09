// src/modules/brooder/brooder.module.ts
import { Module } from '@nestjs/common';
import { BrooderController } from './brooder.controller';
import { BrooderService } from './brooder.service';
import { BrooderMissedLogCron } from './brooder-missed-log.cron';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StoreModule } from '../store/store.module';
import { FlockModule } from '../flock/flock.module';
import { FeedWastageModule } from '../../common/feed/feed-wastage.module';
// NotificationsModule is @Global() so its service is available without
// importing the module — but we import it explicitly here for clarity.

@Module({
  imports: [PrismaModule, StoreModule, FlockModule, FeedWastageModule],
  controllers: [BrooderController],
  providers: [BrooderService, BrooderMissedLogCron],
  exports: [BrooderService],
})
export class BrooderModule {}
