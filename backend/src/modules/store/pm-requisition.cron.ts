// src/modules/store/pm-requisition.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/** Monday of the coming week, as seen from `today`. */
function comingMonday(today: dayjs.Dayjs): Date {
  const daysUntilMon = (8 - today.day()) % 7 || 7;
  return dayjs.utc(today.add(daysUntilMon, 'day').format('YYYY-MM-DD')).startOf('day').toDate();
}

@Injectable()
export class PMRequisitionCron {
  private readonly logger = new Logger(PMRequisitionCron.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * 07:00 every Tuesday — early heads-up, two days before the Thursday
   * deadline. Skipped if the PM has already submitted for the coming week.
   */
  @Cron('0 7 * * 2')
  async earlyReminder() {
    this.logger.log('Running Tuesday early PM requisition reminder');
    await this.sendReminder(
      NotificationType.PM_REQUISITION_EARLY_REMINDER as any,
      'Heads Up — Weekly Item List Due Thursday',
      (monday) =>
        `Send your list of items needed for the week of ${dayjs(monday).format('D MMM')} – ` +
        `${dayjs(monday).add(6, 'day').format('D MMM YYYY')} by Thursday, so Store has it two clear days ` +
        `before their Saturday issuance-plan submission.`,
    );
  }

  /**
   * 06:30 every Thursday — final "due today" reminder. This is the PM's
   * submission deadline: two days ahead of Store's own Saturday cutoff.
   */
  @Cron('30 6 * * 4')
  async dueReminder() {
    this.logger.log('Running Thursday due-today PM requisition reminder');
    await this.sendReminder(
      NotificationType.PM_REQUISITION_DUE_REMINDER as any,
      "It's Thursday — Send This Week's Item List to Store",
      (monday) =>
        `Your list of items needed for the week of ${dayjs(monday).format('D MMM')} – ` +
        `${dayjs(monday).add(6, 'day').format('D MMM YYYY')} is due today, so Store can fold it into the ` +
        `weekly issuance plan before Saturday.`,
    );
  }

  private async sendReminder(
    type: NotificationType,
    title: string,
    message: (monday: Date) => string,
  ) {
    const monday = comingMonday(dayjs());

    const existing = await this.prisma.pMItemRequisition.findFirst({
      where: { weekStartDate: monday, status: 'SUBMITTED' as any },
    });
    if (existing) return; // PM already sent this week's list — no nudge needed

    await this.notifications.notifyRole(UserRole.MANAGER, type, title, message(monday));
  }
}
