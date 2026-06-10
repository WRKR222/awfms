// src/modules/store/store.service.ts
// Feed distribution and egg intake removed from the Store workflow.
// Workflow: PM approval → tally verification directly.
// Store's remaining duties: tally sign-off, inventory, purchase requests,
// HR records, visitor log.
//
// cosignEggIntake() kept for backwards compatibility (used by tally service).
// getPendingIntakes() and createEggIntake() removed.
// logFeedDistribution() and getFeedDistributions() removed.
// getStoreSummary() no longer reports pendingIntakeCount.

import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  async getStoreSummary() {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const lockedBookings = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { in: ['PENDING', 'CONFIRMED'] }, deletedAt: null },
      include: { customer: { select: { name: true } } },
      orderBy: { requestedDate: 'asc' },
    });
    const totalLockedEggs  = lockedBookings.reduce((s, b) => s + b.quantityEggs, 0);
    const totalLockedTrays = lockedBookings.reduce((s, b) => s + b.quantityTrays, 0);

    // Pending tallies awaiting Store signature
    const pendingTallies = await this.prisma.eggTallyVerification.count({
      where: { isLocked: false, storeSignedById: null },
    });

    return {
      pendingTallies,
      lockedBookings, totalLockedEggs, totalLockedTrays,
    };
  }

  // Kept for TallyVerificationService compatibility
  async cosignEggIntake(sessionId: string, userId: string) {
    const tally = await this.prisma.eggTallyVerification.findUnique({
      where: { sessionId },
    });
    if (!tally) throw new NotFoundException('Tally not found for this session');
    if (tally.isLocked) throw new ConflictException('Tally is already locked');
    return this.prisma.eggTallyVerification.update({
      where: { sessionId },
      data: { storeSignedById: userId, storeSignedAt: new Date() },
    });
  }
}
