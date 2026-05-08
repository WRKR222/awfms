import { Module } from '@nestjs/common';
import { VisitorsController } from './visitors.controller';
import { VisitorsService } from './visitors.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { NotificationsModule } from '../../common/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [VisitorsController],
  providers: [VisitorsService],
})
export class VisitorsModule {}
