import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BrooderModule } from '../brooder/brooder.module';

@Module({
  imports: [PrismaModule, BrooderModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
