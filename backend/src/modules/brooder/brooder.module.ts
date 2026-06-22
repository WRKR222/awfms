import { Module } from '@nestjs/common';
import { BrooderController } from './brooder.controller';
import { BrooderService } from './brooder.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BrooderController],
  providers: [BrooderService],
  exports: [BrooderService],
})
export class BrooderModule {}
