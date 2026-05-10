import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import dayjs from 'dayjs';

const VALID_GATES   = new Set(['MAIN_GATE', 'FARM_GATE']);
const VALID_ACTIONS = new Set(['CHECK_IN', 'CHECK_OUT']);

@Injectable()
export class VisitorsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * List approved advance-notice visitors for a given gate + date.
   * Compatible with SecurityVisitorPage and SecurityHome front-end shapes.
   */
  async getApprovedForGate(gate: string, dateStr?: string) {
    if (!VALID_GATES.has(gate)) throw new BadRequestException('Invalid gate');
    const date  = dateStr ? dayjs(dateStr) : dayjs();
    const start = date.startOf('day').toDate();
    const end   = date.endOf('day').toDate();

    const notices = await this.prisma.visitorAdvanceNotice.findMany({
      where: {
        status: 'APPROVED',
        expectedDate: { gte: start, lte: end },
      },
      orderBy: { expectedDate: 'asc' },
    });

    return notices.map(n => ({
      id:            n.id,
      name:          n.visitorName,
      organisation:  n.organisation,
      purpose:       n.purpose,
      destination:   Array.isArray(n.houseIds) && (n.houseIds as string[]).length > 0
        ? `Houses: ${(n.houseIds as string[]).join(', ')}`
        : 'Farm premises',
      expectedCount: n.expectedCount,
      // FIX: Return as expectedDate (not expectedArrival) — matches OwnerVisitorPage interface
      expectedDate:  n.expectedDate,
      vehiclePlate:  null,
    }));
  }

  async getGateLog(gate: string, dateStr?: string) {
    if (!VALID_GATES.has(gate)) throw new BadRequestException('Invalid gate');
    const date  = dateStr ? dayjs(dateStr) : dayjs();
    const start = date.startOf('day').toDate();
    const end   = date.endOf('day').toDate();

    return (this.prisma as any).visitorGateLog.findMany({
      where: { gate, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
    });
  }

  async createGateLog(
    dto: {
      visitorId: string;
      gate: string;
      action: 'CHECK_IN' | 'CHECK_OUT';
      timestamp?: string;
      notes?: string;
    },
    recordedById: string,
  ) {
    if (!VALID_GATES.has(dto.gate))     throw new BadRequestException('Invalid gate');
    if (!VALID_ACTIONS.has(dto.action)) throw new BadRequestException('Invalid action');

    // Validate the advance notice exists and is approved
    const notice = await this.prisma.visitorAdvanceNotice.findUnique({
      where: { id: dto.visitorId },
    });
    if (!notice)                     throw new NotFoundException('Visitor advance notice not found');
    if (notice.status !== 'APPROVED') throw new BadRequestException('Visitor is not approved for entry');

    // ── Entry ordering: FARM_GATE CHECK_IN requires prior MAIN_GATE CHECK_IN ──
    if (dto.action === 'CHECK_IN' && dto.gate === 'FARM_GATE') {
      const mainCheckIn = await (this.prisma as any).visitorGateLog.findFirst({
        where: { visitorId: dto.visitorId, gate: 'MAIN_GATE', action: 'CHECK_IN' },
      });
      if (!mainCheckIn) {
        throw new BadRequestException('Visitor must check in at the Main Gate first');
      }
    }

    // ── Exit ordering (Visitor Exit Sequence Diagram):
    //    MAIN_GATE CHECK_OUT requires prior FARM_GATE CHECK_OUT
    //    (only enforced if visitor was checked in at Farm Gate)
    if (dto.action === 'CHECK_OUT' && dto.gate === 'MAIN_GATE') {
      const farmCheckIn = await (this.prisma as any).visitorGateLog.findFirst({
        where: { visitorId: dto.visitorId, gate: 'FARM_GATE', action: 'CHECK_IN' },
      });
      if (farmCheckIn) {
        // They entered the farm — verify they have also exited the farm first
        const farmCheckOut = await (this.prisma as any).visitorGateLog.findFirst({
          where: { visitorId: dto.visitorId, gate: 'FARM_GATE', action: 'CHECK_OUT' },
        });
        if (!farmCheckOut) {
          throw new BadRequestException(
            'Visitor must check out at the Farm Gate before exiting the Main Gate',
          );
        }
      }
    }

    // ── Prevent duplicate consecutive actions on the same gate ────────────────
    const last = await (this.prisma as any).visitorGateLog.findFirst({
      where: { visitorId: dto.visitorId, gate: dto.gate },
      orderBy: { timestamp: 'desc' },
    });
    if (last && last.action === dto.action) {
      throw new BadRequestException(
        `Visitor is already ${dto.action === 'CHECK_IN' ? 'inside' : 'departed'} at this gate`,
      );
    }

    const log = await (this.prisma as any).visitorGateLog.create({
      data: {
        visitorId:    dto.visitorId,
        gate:         dto.gate,
        action:       dto.action,
        timestamp:    dto.timestamp ? new Date(dto.timestamp) : new Date(),
        recordedById,
        notes:        dto.notes,
      },
    });

    // ── Notify Manager on final compound exit (Main Gate CHECK_OUT) ────────────
    if (dto.action === 'CHECK_OUT' && dto.gate === 'MAIN_GATE') {
      try {
        await this.notifications.notifyRole(
          'MANAGER' as any,
          'SYSTEM' as any,
          'Visitor Departed',
          `${notice.visitorName}${notice.organisation ? ` (${notice.organisation})` : ''} has left the farm.`,
          { entityId: notice.id, entityType: 'visitor_advance_notice' },
        );
      } catch { /* best-effort */ }
    }

    return log;
  }

  /**
   * Record exit time on an existing gate log entry.
   * FIX: Was using this.prisma.visitorGateLog directly (TS error) — now uses (as any) cast.
   */
  async checkoutVisitor(logId: string, userId: string) {
    const log = await (this.prisma as any).visitorGateLog.findUnique({ where: { id: logId } });
    if (!log)          throw new NotFoundException('Gate log entry not found');
    if (log.checkOutAt) throw new BadRequestException('Visitor has already checked out');

    return (this.prisma as any).visitorGateLog.update({
      where: { id: logId },
      data:  { checkOutAt: new Date() },
    });
  }
}
