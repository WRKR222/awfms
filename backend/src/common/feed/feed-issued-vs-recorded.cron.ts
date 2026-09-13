// src/common/feed/feed-issued-vs-recorded.cron.ts
//
// Egg Collection and Brooder feed logging no longer gate on a specific
// Store-issued item (see LAYER_FEED_TYPES on the frontend) — this is the
// monitoring that replaced that gate. Once a day, for every active batch,
// compares yesterday's Store issuance (StoreStockOut) against what
// attendants recorded feeding that batch that day (FeedIntakeLog /
// BrooderGeneralFeedLog) and notifies the Director of any mismatch beyond
// tolerance — see FeedWastageService.notifyIfIssuedVsRecordedMismatch for
// the actual comparison and tolerance.
//
// Checks YESTERDAY, not today: today's issuance/recording isn't finished
// yet at any fixed hour, so checking it would produce false alarms for a
// day still in progress. Cron time is farm-local, same convention as every
// other cron in this codebase.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { FeedWastageService } from './feed-wastage.service';
import { farmTodayUtcMidnight } from '../feed/feed-standard.util';

@Injectable()
export class FeedIssuedVsRecordedCron {
  private readonly logger = new Logger(FeedIssuedVsRecordedCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feedWastage: FeedWastageService,
  ) {}

  /** 6:00am — well after both AM and PM shifts have finished logging feed
   *  for the previous day. */
  @Cron('0 6 * * *')
  async checkYesterday() {
    const yesterday = new Date(farmTodayUtcMidnight().getTime() - 24 * 60 * 60 * 1000);

    const batches = await this.prisma.batch.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, batchCode: true },
    });
    if (batches.length === 0) return;

    let mismatches = 0;
    for (const batch of batches) {
      try {
        const result = await this.feedWastage.notifyIfIssuedVsRecordedMismatch(batch, yesterday);
        if (result) mismatches += 1;
      } catch (err) {
        this.logger.warn(`Issued-vs-recorded check failed for ${batch.batchCode}: ${(err as any)?.message}`);
      }
    }

    if (mismatches > 0) {
      this.logger.warn(`Feed issued-vs-recorded mismatch for ${yesterday.toISOString().slice(0, 10)} — ${mismatches} batch(es).`);
    }
  }
}
