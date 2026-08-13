import { Global, Module } from '@nestjs/common';
import { FeedWastageService } from './feed-wastage.service';

// @Global so both BrooderModule (manual feed entry) and StoreModule
// (production-report auto-fill) can inject FeedWastageService without
// either module importing the other — see feed-wastage.service.ts header
// comment for why this needed to move out of BrooderService.
@Global()
@Module({
  providers: [FeedWastageService],
  exports: [FeedWastageService],
})
export class FeedWastageModule {}
