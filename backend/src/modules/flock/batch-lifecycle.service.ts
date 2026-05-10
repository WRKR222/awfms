// src/modules/flock/batch-lifecycle.service.ts
// OO Design: BatchLifecycleService — dedicated service for all batch state transitions
// Class Diagram methods: markBatchAsSold(), discardSoldBatch(), closeSoldBatch(),
//                        validateLifecycleTransition()

import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BatchStage } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';

// Valid lifecycle transitions: from → allowed_to[]
const VALID_TRANSITIONS: Record<BatchStage, BatchStage[]> = {
  [BatchStage.BROODING]:   [BatchStage.GROWER, BatchStage.PRODUCTION, BatchStage.SOLD, BatchStage.DISCARDED],
  [BatchStage.GROWER]:     [BatchStage.PRODUCTION, BatchStage.SOLD, BatchStage.DISCARDED],
  [BatchStage.PRODUCTION]: [BatchStage.SOLD, BatchStage.DISCARDED, BatchStage.CLOSED],
  [BatchStage.SOLD]:       [BatchStage.CLOSED],
  [BatchStage.DISCARDED]:  [BatchStage.CLOSED],
  [BatchStage.CLOSED]:     [],
};

@Injectable()
export class BatchLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Validate that a stage transition is allowed. Throws BadRequestException if not. */
  validateLifecycleTransition(from: BatchStage, to: BatchStage): void {
    const allowed = VALID_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid lifecycle transition: ${from} → ${to}. Allowed: [${allowed.join(', ') || 'none'}]`,
      );
    }
  }

  /** Mark a batch as SOLD. Records saleDetails in notes. Closes it for egg production. */
  async markBatchAsSold(batchId: string, user: RequestUser, saleDetails?: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    this.validateLifecycleTransition(batch.stage, BatchStage.SOLD);

    return this.prisma.batch.update({
      where: { id: batchId },
      data: {
        stage:    BatchStage.SOLD,
        isActive: false,
        soldAt:   new Date(),
        notes:    batch.notes
          ? `${batch.notes}\nSold by ${user.username} on ${new Date().toISOString().slice(0, 10)}${saleDetails ? ': ' + saleDetails : ''}`
          : `Sold by ${user.username} on ${new Date().toISOString().slice(0, 10)}${saleDetails ? ': ' + saleDetails : ''}`,
      },
    });
  }

  /** Discard a batch (culled / non-commercially closed). Records reason. */
  async discardBatch(batchId: string, user: RequestUser, reason?: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    this.validateLifecycleTransition(batch.stage, BatchStage.DISCARDED);

    return this.prisma.batch.update({
      where: { id: batchId },
      data: {
        stage:       BatchStage.DISCARDED,
        isActive:    false,
        discardedAt: new Date(),
        notes:       batch.notes
          ? `${batch.notes}\nDiscarded by ${user.username} on ${new Date().toISOString().slice(0, 10)}${reason ? ': ' + reason : ''}`
          : `Discarded by ${user.username} on ${new Date().toISOString().slice(0, 10)}${reason ? ': ' + reason : ''}`,
      },
    });
  }

  /** Administratively close a batch (post-SOLD or post-DISCARDED). */
  async closeBatch(batchId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    this.validateLifecycleTransition(batch.stage, BatchStage.CLOSED);

    return this.prisma.batch.update({
      where: { id: batchId },
      data: { stage: BatchStage.CLOSED, isActive: false, closedAt: new Date() },
    });
  }

  /**
   * Transfer batch to a new stage (e.g. BROODING → PRODUCTION).
   * Also creates/updates BatchCageAssignment records when moving to PRODUCTION.
   */
  async updateBatchStage(
    batchId: string,
    newStage: BatchStage,
    user: RequestUser,
    rowPlacements?: Array<{ rowId: string; birdCount: number }>,
  ) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    this.validateLifecycleTransition(batch.stage, newStage);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.batch.update({
        where: { id: batchId },
        data: {
          stage:    newStage,
          location: newStage === BatchStage.PRODUCTION ? 'PRODUCTION_HOUSE' : 'BROODER',
          // If transitioning back from sold/discarded (edge case) keep isActive true
          isActive: !([BatchStage.SOLD, BatchStage.DISCARDED, BatchStage.CLOSED] as BatchStage[]).includes(newStage),
        },
      });

      // When moving to PRODUCTION, write row assignments
      if (newStage === BatchStage.PRODUCTION && rowPlacements?.length) {
        for (const placement of rowPlacements) {
          await tx.batchCageAssignment.upsert({
            where: { rowId: placement.rowId },
            create: {
              rowId:        placement.rowId,
              batchId,
              birdCount:    placement.birdCount,
              transferDate: new Date(),
              assignedById: user.id,
            },
            update: {
              batchId,
              birdCount:    placement.birdCount,
              transferDate: new Date(),
              assignedById: user.id,
            },
          });
        }
      }

      return updated;
    });
  }
}
