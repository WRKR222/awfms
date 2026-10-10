// src/common/feed/feed-wastage-recompute.cron.ts
//
// Safety net for feed wastage: every hour, re-check the last 14 days of every
// batch against what is recorded now. Write paths already recompute the days
// they touch (feed entries, egg sessions, report uploads and rollbacks); this
// catches anything changed some other way, so the Director's figures never
// stay stale.
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedWastageService } from './feed-wastage.service';

@Injectable()
export class FeedWastageRecomputeCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeedWastageRecomputeCron.name);
  private running = false;

  constructor(private readonly feedWastage: FeedWastageService) {}

  /** After each deploy, re-check the full history once (in the background)
   *  so rows written under older rules are brought in line too. */
  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    setTimeout(() => { void this.run(3650); }, 60_000).unref();
  }

  @Cron('17 * * * *')
  async run(days = 14) {
    if (this.running) return;
    this.running = true;
    try {
      const { batches } = await this.feedWastage.recomputeRecent(days);
      this.logger.log(`Feed wastage re-checked for ${batches} batch(es)`);
    } catch (err) {
      this.logger.warn(`Feed wastage recompute failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
