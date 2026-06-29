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

  /** 07:00 daily — remind Director about pending plans */
  @Cron('0 7 * * *')
  async pendingReminder() {
    this.logger.log('Running issuance plan pending reminders');
    await this.issuancePlanService.sendPendingReminders();
  }

  /**
   * 07:00 every Thursday — early reminder to Store to start drafting the
   * weekly issuance plan before the Saturday submission deadline.
   * Two days notice gives them time to gather quantities and cross-check stock.
   */
  @Cron('0 7 * * 4')
  async earlyWeeklyPlanReminder() {
    this.logger.log('Running Thursday early weekly issuance plan reminder');
    await this.issuancePlanService.sendEarlyWeeklyPlanReminder();
  }

  /**
   * 07:00 every Saturday — final reminder to Store to submit the weekly plan.
   * Also the day Store must submit and the Director can approve.
   */
  @Cron('0 7 * * 6')
  async weeklyPlanReminder() {
    this.logger.log('Running Saturday weekly issuance plan reminder');
    await this.issuancePlanService.sendWeeklyPlanReminder();
  }
}
