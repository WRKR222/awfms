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
import { ProductionCageService, HOUSE_CODES } from '../production/production-cage.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly productionCages: ProductionCageService,
  ) {}

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
    houseCode?: string,
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

      // Leaving BROODING (to GROWER, PRODUCTION, SOLD or DISCARDED) frees up
      // any brooder cage-map levels this batch was occupying, so the next
      // batch keyed into the brooder can be placed there. Historical feed
      // and heat logs are untouched — they remain queryable by level/date
      // for full from-brooder-to-production-house traceability.
      if (batch.stage === BatchStage.BROODING && newStage !== BatchStage.BROODING) {
        await tx.brooderCageAssignment.deleteMany({ where: { batchId } });
        await tx.brooderLevelAssignment.deleteMany({ where: { batchId } });
      }

      // Leaving the production house (sold / discarded / closed) frees its cages.
      if (batch.stage === BatchStage.PRODUCTION && newStage !== BatchStage.PRODUCTION) {
        const rows = await tx.productionCage.findMany({
          where: { assignment: { batchId } }, select: { rowId: true },
        });
        await tx.productionCageAssignment.deleteMany({ where: { batchId } });
        await this.productionCages.recomputeRowRollups(tx, rows.map(r => r.rowId!).filter(Boolean), user.id);
      }

      // When moving to PRODUCTION, place the birds into empty cages of the
      // chosen production house (Block 1 by default), optionally pinned per
      // row. The per-row BatchCageAssignment rollup is maintained from the
      // cages. Partial transfers go through ProductionCageService.transferFromBrooder.
      if (newStage === BatchStage.PRODUCTION && rowPlacements?.length) {
        const code = (houseCode ?? 'BLK1').toUpperCase();
        if (!HOUSE_CODES.includes(code as any)) throw new BadRequestException('Unknown production house');
        await this.productionCages.placeBatchInHouse(tx, {
          batchId,
          houseCode: code,
          placements: rowPlacements
            .filter(p => Number(p.birdCount) > 0)
            .map(p => ({ rowCode: p.rowId, birds: Number(p.birdCount) })),
          placedDate: new Date(),
          userId: user.id,
        });
      }

      return updated;
    });
  }
}
