// src/modules/breed-standards/breed-standards.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StandardComplianceService } from './standard-compliance.service';

@Injectable()
export class BreedStandardsCron {
  private readonly logger = new Logger(BreedStandardsCron.name);
  constructor(private readonly compliance: StandardComplianceService) {}

  /** Every night: score yesterday's completed guide weeks for every active batch. */
  @Cron('15 2 * * *', { timeZone: 'Africa/Nairobi' })
  async nightly() {
    const r = await this.compliance.evaluateActiveBatches();
    this.logger.log(`Breed standards: ${r.batches} batch(es) evaluated, ${r.newDeviations} new deviation(s) notified`);
  }
}
