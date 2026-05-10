import { Module } from '@nestjs/common';
import { FlockController } from './flock.controller';
import { FlockService } from './flock.service';
import { BatchLifecycleService } from './batch-lifecycle.service';

@Module({
  controllers: [FlockController],
  providers: [FlockService, BatchLifecycleService],
  exports: [FlockService, BatchLifecycleService],
})
export class FlockModule {}
