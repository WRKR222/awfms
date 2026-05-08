import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
