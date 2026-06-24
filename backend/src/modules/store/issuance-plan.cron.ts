// src/modules/store/issuance-plan.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IssuancePlanService } from './issuance-plan.service';

@Injectable()
export class IssuancePlanCron {
  private readonly logger = new Logger(IssuancePlanCron.name);

  constructor(private readonly issuancePlanService: IssuancePlanService) {}

  /** 06:00 daily — send daily feed issuance alerts to Store */
  @Cron('0 6 * * *')
  async dailyFeedAlert() {
    this.logger.log('Running daily feed issuance alert');
    await this.issuancePlanService.sendDailyFeedAlert();
  }

  /** 07:00 daily — remind Accountant / Director about pending plans */
  @Cron('0 7 * * *')
  async pendingReminder() {
    this.logger.log('Running issuance plan pending reminders');
    await this.issuancePlanService.sendPendingReminders();
  }

  /** 07:00 every Saturday — remind Store to draft the weekly issuance plan */
  @Cron('0 7 * * 6')
  async weeklyPlanReminder() {
    this.logger.log('Running Saturday weekly issuance plan reminder');
    await this.issuancePlanService.sendWeeklyPlanReminder();
  }
}
