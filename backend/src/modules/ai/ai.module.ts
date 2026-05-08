import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],   // NotificationsService injected via @Global NotificationsModule
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],      // exported so FlockModule can inject AiService for AI-03
})
export class AiModule {}
