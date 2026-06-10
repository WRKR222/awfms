import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

// FIX: Added PrismaModule — FeedService injects PrismaService.
// FIX: Added NotificationsModule — FeedService injects NotificationsService for low-stock alerts.
// Both were absent; the app relied silently on @Global() decoration of those modules, which
// is a fragile implicit dependency and breaks if globality is ever removed.

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
