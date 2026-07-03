import { Module } from '@nestjs/common';
import { FlockController } from './flock.controller';
import { FlockService } from './flock.service';
import { BatchLifecycleService } from './batch-lifecycle.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { StoreModule } from '../store/store.module';

// FIX: Added PrismaModule — both FlockService and BatchLifecycleService inject PrismaService.
// The module was relying silently on the @Global() decorator of PrismaModule rather than
// declaring an explicit dependency.

@Module({
  imports: [PrismaModule, StoreModule],
  controllers: [FlockController],
  providers: [FlockService, BatchLifecycleService],
  exports: [FlockService, BatchLifecycleService],
})
export class FlockModule {}
