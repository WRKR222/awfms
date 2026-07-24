// src/modules/store/store-inventory.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole, StoreItemCategory } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { IssuancePlanService } from './issuance-plan.service';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import {
  IsString, IsOptional, IsNumber, IsBoolean, Min, IsNotEmpty, IsEnum, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

dayjs.extend(isoWeek);

// ─── DTOs ────────────────────────────────────────────────────────────────────

export class CreateStoreItemDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  sku: string;

  @IsString() @IsNotEmpty()
  category: string;

  @IsString() @IsNotEmpty() @MaxLength(30, { message: 'Unit must be 30 characters or fewer' })
  unit: string;

  @IsOptional() @IsString()
  description?: string;

  // No @Min() here — a negative reorder level is intentional for items
  // bought once or rarely (e.g. a one-off tool purchase). It means
  // "never flag this as low stock" since currentStock (never negative)
  // will always be greater than a negative threshold. See the low-stock
  // check in this file and on the store dashboard.
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false })
  reorderLevel?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  unitCostKes?: number;

  @IsOptional() @IsString()
  supplierId?: string;
}

export class UpdateStoreItemDto {
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;

  @IsOptional() @IsEnum(StoreItemCategory, { message: 'Invalid category value' })
  category?: string;

  @IsOptional() @IsString() @IsNotEmpty({ message: 'Unit is required' }) @MaxLength(30, { message: 'Unit must be 30 characters or fewer' })
  unit?: string;

  @IsOptional() @IsString()
  description?: string;

  // See CreateStoreItemDto above — negative values are intentional.
  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false })
  reorderLevel?: number;

  @IsOptional() @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0)
  unitCostKes?: number;

  @IsOptional() @IsString()
  supplierId?: string;

  @IsOptional() @Type(() => Boolean) @IsBoolean()
  isActive?: boolean;
}

export interface StockInDto {
  storeItemId: string;
  receivedDate: string;
  quantityIn: number;
  unitCostKes: number;
  supplierName?: string;
  invoiceRef?: string;
  notes?: string;
}

export interface StockOutDto {
  storeItemId: string;
  issuedDate: string;
  quantityOut: number;
  recipientRole?: string;
  otherRecipient?: string;
  issuedToName?: string;
  issuedToHouseId?: string;
  issuedToBatchId?: string;
  purpose?: string;
  notes?: string;
}

// ─── SERVICE ─────────────────────────────────────────────────────────────────

@Injectable()
export class StoreInventoryService {
  private readonly logger = new Logger(StoreInventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly issuancePlanService: IssuancePlanService,
  ) {}


  // Map role codes to human-readable labels for stock out records
  private readonly ROLE_LABELS: Record<string, string> = {
    MANAGER: 'Production Manager',
    ATTENDANT: 'Lead Attendant',
    SALES: 'Sales',
    ACCOUNTANT: 'Accountant',
    STORE: 'Store',
    SECURITY1: 'Security (Main Gate)',
    SECURITY2: 'Security (Farm Gate)',
    OWNER: 'Director',
  };

  // ── Store Items (Catalogue) ──────────────────────────────────────────────────

  async listItems(category?: string, isActive?: boolean) {
    return this.prisma.storeItem.findMany({
      where: {
        ...(category ? { category: category as any } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async getItemById(id: string) {
    const item = await this.prisma.storeItem.findUnique({
      where: { id },
      include: {
        stockIns:  { orderBy: { receivedDate: 'desc' }, take: 10 },
        stockOuts: { orderBy: { issuedDate: 'desc' }, take: 10 },
      },
    });
    if (!item) throw new NotFoundException('Store item not found');
    return item;
  }

  async createItem(dto: CreateStoreItemDto, user: RequestUser) {
    const existing = await this.prisma.storeItem.findUnique({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException(`SKU "${dto.sku}" is already in use`);

    return this.prisma.storeItem.create({
      data: {
        name:         dto.name,
        sku:          dto.sku,
        category:     dto.category as any,
        unit:         dto.unit.trim(),
        description:  dto.description ?? null,
        reorderLevel: dto.reorderLevel ?? 0,
        unitCostKes:  dto.unitCostKes ?? 0,
        supplierId:   dto.supplierId ?? null,
        createdById:  user.id,
      },
    });
  }

  async updateItem(id: string, dto: UpdateStoreItemDto) {
    await this.getItemById(id);
    return this.prisma.storeItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined ? { category: dto.category as any } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: Number(dto.reorderLevel) } : {}),
        ...(dto.unitCostKes !== undefined ? { unitCostKes: Number(dto.unitCostKes) } : {}),
        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /**
   * Permanently delete a store item so its SKU can be recycled.
   * Blocked if the item still has stock on hand OR has any stock-in/out history
   * (to preserve ledger integrity). Both conditions must be clear before deletion.
   */
  async deleteItem(id: string) {
    const item = await this.getItemById(id);

    if (Number(item.currentStock) > 0) {
      throw new BadRequestException(
        `Cannot delete "${item.name}" — it still has ${item.currentStock} ${item.unit} in stock. ` +
        `Issue out or adjust to zero before deleting.`,
      );
    }

    const [stockInCount, stockOutCount] = await Promise.all([
      this.prisma.storeStockIn.count({ where: { storeItemId: id } }),
      this.prisma.storeStockOut.count({ where: { storeItemId: id } }),
    ]);

    if (stockInCount > 0 || stockOutCount > 0) {
      throw new BadRequestException(
        `Cannot delete "${item.name}" — it has existing stock movement records (${stockInCount} stock-in, ${stockOutCount} stock-out). ` +
        `Items with transaction history cannot be permanently deleted to preserve audit records. ` +
        `If you no longer need this item, contact an administrator.`,
      );
    }

    await this.prisma.storeItem.delete({ where: { id } });
    return { deleted: true, id, sku: item.sku };
  }

  async getLowStockItems() {
    const items = await this.prisma.storeItem.findMany({ where: { isActive: true } });
    return items.filter(
      (i) => Number(i.currentStock) <= Number(i.reorderLevel),
    );
  }

  // ── Stock In ─────────────────────────────────────────────────────────────────

  async recordStockIn(dto: StockInDto, user: RequestUser) {
    const item = await this.prisma.storeItem.findUnique({ where: { id: dto.storeItemId } });
    if (!item) throw new NotFoundException('Store item not found');

    const totalCostKes = dto.quantityIn * dto.unitCostKes;

    const [stockIn] = await this.prisma.$transaction([
      this.prisma.storeStockIn.create({
        data: {
          storeItemId:  dto.storeItemId,
          receivedDate: new Date(dto.receivedDate),
          quantityIn:   dto.quantityIn,
          unitCostKes:  dto.unitCostKes,
          totalCostKes,
          supplierName: dto.supplierName ?? null,
          invoiceRef:   dto.invoiceRef ?? null,
          notes:        dto.notes ?? null,
          receivedById: user.id,
        },
      }),
      this.prisma.storeItem.update({
        where: { id: dto.storeItemId },
        data: { currentStock: { increment: dto.quantityIn }, unitCostKes: dto.unitCostKes },
      }),
    ]);

    return stockIn;
  }

  async listStockIns(storeItemId?: string, fromDate?: string, toDate?: string) {
    return this.prisma.storeStockIn.findMany({
      where: {
        ...(storeItemId ? { storeItemId } : {}),
        ...(fromDate || toDate
          ? {
              receivedDate: {
                ...(fromDate ? { gte: new Date(fromDate) } : {}),
                ...(toDate ? { lte: new Date(toDate) } : {}),
              },
            }
          : {}),
      },
      include: {
        storeItem:  { select: { name: true, unit: true, sku: true } },
        receivedBy: { select: { fullName: true } },
      },
      orderBy: { receivedDate: 'desc' },
      take: 100,
    });
  }

  // ── Stock Out ─────────────────────────────────────────────────────────────────

  async recordStockOut(dto: StockOutDto, user: RequestUser) {
    const item = await this.prisma.storeItem.findUnique({ where: { id: dto.storeItemId } });
    if (!item) throw new NotFoundException('Store item not found');
    if (Number(item.currentStock) < dto.quantityOut) {
      throw new BadRequestException(
        `Insufficient stock. Available: ${item.currentStock} ${item.unit}`,
      );
    }

    // ── Issuance Plan Gate ─────────────────────────────────────────────────
    // Every stock-out must be authorised by an approved issuance plan line.
    // validateStockOut throws BadRequestException with a clear message if not.
    const planAuth = await this.issuancePlanService.validateStockOut(
      dto.storeItemId,
      dto.quantityOut,
      new Date(dto.issuedDate),
    );
    // ── End Gate ───────────────────────────────────────────────────────────

    const totalCostKes = dto.quantityOut * Number(item.unitCostKes);

    // Use interactive transaction so we can capture the updated item (GAP-05)
    const { stockOut, updatedItem } = await this.prisma.$transaction(async (tx) => {
      const so = await tx.storeStockOut.create({
        data: {
          storeItemId:       dto.storeItemId,
          issuedDate:        new Date(dto.issuedDate),
          quantityOut:       dto.quantityOut,
          unitCostKes:       item.unitCostKes,
          totalCostKes,
          issuedToName:      dto.recipientRole ? (this.ROLE_LABELS[dto.recipientRole] ?? dto.otherRecipient ?? dto.recipientRole) : (dto.issuedToName ?? null),
          issuedToHouseId:   dto.issuedToHouseId ?? null,
          issuedToBatchId:   dto.issuedToBatchId ?? null,
          purpose:           dto.purpose ?? null,
          notes:             dto.notes ?? null,
          issuedById:        user.id,
          issuancePlanId:    planAuth.planId,
          issuancePlanItemId: planAuth.planItemId,
        },
      });

      const ui = await tx.storeItem.update({
        where: { id: dto.storeItemId },
        data: { currentStock: { decrement: dto.quantityOut } },
      });

      return { stockOut: so, updatedItem: ui };
    });

    // Increment the plan item's running issued quantity
    await this.issuancePlanService.incrementIssuedQuantity(planAuth.planItemId, dto.quantityOut);

    // ── GAP-05: Reorder-level alert ──────────────────────────────────────────
    // After the decrement, if the item is now at or below its reorder level,
    // create an in-app REORDER_ALERT notification for all active Store users
    // so they are prompted to raise a Purchase Request.
    if (Number(updatedItem.currentStock) <= Number(updatedItem.reorderLevel)) {
      const storeUsers = await this.prisma.user.findMany({
        where: { role: 'STORE', isActive: true },
        select: { id: true },
      });

      for (const u of storeUsers) {
        // De-duplicate: skip if an unread alert already exists for this item
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId:     u.id,
            entityId:   dto.storeItemId,
            entityType: 'StoreItem',
            type:       'REORDER_ALERT',
            isRead:     false,
          },
        });
        if (!existing) {
          await this.prisma.notification.create({
            data: {
              userId:     u.id,
              type:       'REORDER_ALERT',
              title:      `Low stock alert: ${item.name}`,
              message:
                `${item.name} (${item.sku}) is now at ${updatedItem.currentStock} ${item.unit}, ` +
                `at or below the reorder level of ${updatedItem.reorderLevel} ${item.unit}. ` +
                `Please raise a Purchase Request.`,
              entityId:   dto.storeItemId,
              entityType: 'StoreItem',
            },
          });
        }
      }
    }
    // ── END GAP-05 ──────────────────────────────────────────────────────────

    // Notify recipient role about the issuance
    if (dto.recipientRole && dto.recipientRole !== 'OTHER') {
      const validRoles = Object.values(UserRole);
      if (validRoles.includes(dto.recipientRole as any)) {
        const msg = 'Store has issued ' + dto.quantityOut + ' ' + item.unit + ' of ' + item.name + ' to you.';
        await this.notifications.notifyRole(
          dto.recipientRole as any,
          NotificationType.SYSTEM,
          'Stock Issued: ' + item.name,
          dto.purpose ? msg + ' Purpose: ' + dto.purpose : msg,
        ).catch(() => {});
      }
    }

    return stockOut;
  }

  async listStockOuts(storeItemId?: string, fromDate?: string, toDate?: string) {
    return this.prisma.storeStockOut.findMany({
      where: {
        ...(storeItemId ? { storeItemId } : {}),
        ...(fromDate || toDate
          ? {
              issuedDate: {
                ...(fromDate ? { gte: new Date(fromDate) } : {}),
                ...(toDate ? { lte: new Date(toDate) } : {}),
              },
            }
          : {}),
      },
      include: {
        storeItem: { select: { name: true, unit: true, sku: true } },
        issuedBy:  { select: { fullName: true } },
      },
      orderBy: { issuedDate: 'desc' },
      take: 100,
    });
  }

  // ── Expiry Alerts ──────────────────────────────────────────────────────────

  async getExpiringItems() {
    const now = new Date();
    const oneMonth = new Date(now); oneMonth.setMonth(oneMonth.getMonth() + 1);
    const twoMonths = new Date(now); twoMonths.setMonth(twoMonths.getMonth() + 2);

    // Find stock-in records with expiry dates within 2 months
    const expiringStock = await this.prisma.storeStockIn.findMany({
      where: {
        expiryDate: { lte: twoMonths, gte: now },
      },
      include: {
        storeItem: { select: { id: true, name: true, sku: true, category: true, unit: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return expiringStock.map(s => {
      const daysUntil = Math.ceil((new Date(s.expiryDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return {
        id: s.id,
        item: s.storeItem,
        expiryDate: s.expiryDate,
        daysUntilExpiry: daysUntil,
        severity: daysUntil <= 30 ? 'critical' : 'warning',
        quantityIn: s.quantityIn,
        supplierName: s.supplierName,
      };
    });
  }

  // ── Issuable items + residual (feed / medication) ────────────────────────
  //
  // Powers two things:
  //   1. The Lead Attendant's feed / vaccine / supplement / treatment logging
  //      dropdowns — only items actually issued out of the store this week
  //      should be selectable, so the attendant can't log against something
  //      that was never physically handed to them.
  //   2. The Store's weekly issuance-plan screen — showing how much of what
  //      was issued last week is still sitting unused (residual) so Store
  //      doesn't over-issue the same item again next week.
  //
  // "This week" follows the same Mon–Sun window the issuance plan itself
  // uses (see IssuancePlanService.validateStockOut).
  async getIssuableStoreItems(categories: StoreItemCategory[]) {
    const items = await this.prisma.storeItem.findMany({
      where: { category: { in: categories }, isActive: true },
      select: { id: true, name: true, sku: true, unit: true, category: true },
    });
    if (items.length === 0) return [];
    const itemIds = items.map(i => i.id);

    // ── ALL-TIME running stock ledger ─────────────────────────────────────
    // Residual = (everything ever issued to this item) - (everything ever
    // dispensed against it). No calendar-week boundary anywhere in this
    // calculation.
    //
    // This replaces an earlier Mon–Sun "this week" window (even one anchored
    // to each item's earliest issuance date) because ANY hard date floor
    // has the same failure mode: an attendant backdating a dispense to a
    // day before that floor — e.g. logging last Saturday's feeding after
    // Store's Monday stock-out — gets silently excluded from the sum, and
    // the residual on screen never reflects feed that was genuinely used.
    // A real inventory floor (dispensing stops at 0, permanently, until
    // Store issues more) requires a genuine running balance, not a window
    // that resets every Monday regardless of what's actually left.
    const issuedGroups = await this.prisma.storeStockOut.groupBy({
      by: ['storeItemId'],
      where: { storeItemId: { in: itemIds } },
      _sum: { quantityOut: true },
    });
    const issuedMap = new Map<string, number>(
      issuedGroups.map(g => [g.storeItemId, Number(g._sum.quantityOut ?? 0)]),
    );

    // Dispensed — feed (BrooderLevelFeedLog), all-time.
    const feedGroups = await this.prisma.brooderLevelFeedLog.groupBy({
      by: ['storeItemId'],
      where: { storeItemId: { in: itemIds } },
      _sum: { quantityDispensedKg: true },
    });
    const dispensedMap = new Map<string, number>();
    for (const g of feedGroups) {
      if (!g.storeItemId) continue;
      dispensedMap.set(g.storeItemId, (dispensedMap.get(g.storeItemId) ?? 0) + Number(g._sum.quantityDispensedKg ?? 0));
    }

    // Dispensed — feed (BrooderGeneralFeedLog), all-time. Whole-batch feed
    // entries logged via the "General Population Record" sheet land here,
    // not in BrooderLevelFeedLog, and were previously omitted from this
    // sum entirely — causing Dispensed/Remaining to never reflect feed
    // logged through that path.
    const generalFeedGroups = await this.prisma.brooderGeneralFeedLog.groupBy({
      by: ['storeItemId'],
      where: { storeItemId: { in: itemIds } },
      _sum: { quantityDispensedKg: true },
    });
    for (const g of generalFeedGroups) {
      if (!g.storeItemId) continue;
      dispensedMap.set(g.storeItemId, (dispensedMap.get(g.storeItemId) ?? 0) + Number(g._sum.quantityDispensedKg ?? 0));
    }

    // Dispensed — treatments (BrooderTreatmentLog.quantityUsed), all-time.
    const treatmentGroups = await (this.prisma as any).brooderTreatmentLog.groupBy({
      by: ['storeItemId'],
      where: { storeItemId: { in: itemIds } },
      _sum: { quantityUsed: true },
    });
    for (const g of treatmentGroups) {
      if (!g.storeItemId) continue;
      dispensedMap.set(g.storeItemId, (dispensedMap.get(g.storeItemId) ?? 0) + Number(g._sum.quantityUsed ?? 0));
    }

    // Dispensed — vaccines/supplements tagged with a storeItemId inside the
    // brooder_logs JSONB arrays, all-time (no direct column to group by).
    const brooderLogs = await this.prisma.brooderLog.findMany({
      select: { vaccinesJson: true, supplementsJson: true },
    });
    for (const log of brooderLogs) {
      const entries = [
        ...((log.vaccinesJson as any[]) ?? []),
        ...((log.supplementsJson as any[]) ?? []),
      ];
      for (const entry of entries) {
        if (entry?.storeItemId && itemIds.includes(entry.storeItemId) && entry?.quantityUsed != null) {
          dispensedMap.set(
            entry.storeItemId,
            (dispensedMap.get(entry.storeItemId) ?? 0) + Number(entry.quantityUsed ?? 0),
          );
        }
      }
    }

    return items
      .map(item => {
        // NOTE: field names kept as `issuedThisWeek`/`dispensedThisWeek` for
        // backward compatibility with the frontend types/labels — they now
        // hold ALL-TIME totals, not calendar-week totals. Update UI copy
        // if "this week" wording would be misleading in context.
        const issuedThisWeek = Math.round((issuedMap.get(item.id) ?? 0) * 1000) / 1000;
        const dispensedThisWeek = Math.round((dispensedMap.get(item.id) ?? 0) * 1000) / 1000;
        const residual = Math.max(0, Math.round((issuedThisWeek - dispensedThisWeek) * 1000) / 1000);

        // DIAGNOSTIC — kept at debug level, safe to leave on in production.
        if ((item.category as any) === 'FEED' || (item.category as any) === 'FEED_SUPPLEMENT') {
          this.logger.debug(
            `[Residual] item=${item.name} (${item.id}) issuedAllTime=${issuedThisWeek} ` +
            `dispensedAllTime=${dispensedThisWeek} residual=${residual}`,
          );
        }

        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          unit: item.unit,
          category: item.category,
          issuedThisWeek,
          dispensedThisWeek,
          residual,
        };
      })
      // An item stays issuable as long as there's unconsumed stock against
      // it — not just during the calendar week it happened to be issued in.
      .filter(i => i.residual > 0);
  }

  // ── Single-item residual lookup ─────────────────────────────────────────
  // Used by BrooderService/FlockService to hard-validate a dispense (feed,
  // vaccine, supplement, treatment) against what's actually left of a store
  // item BEFORE writing the log — not just whether it was issued at all.
  // Reuses getIssuableStoreItems' full computation (earliest-issuance
  // anchoring, all four dispensing sources) so the number matches exactly
  // what the attendant/store screens display.
  async getResidualForItem(
    storeItemId: string,
  ): Promise<{ issuedThisWeek: number; dispensedThisWeek: number; residual: number } | null> {
    const item = await this.prisma.storeItem.findUnique({
      where:  { id: storeItemId },
      select: { category: true },
    });
    if (!item) return null;

    const list = await this.getIssuableStoreItems([item.category]);
    const match = list.find(i => i.id === storeItemId);
    // Not in the list means issuedThisWeek is 0 (getIssuableStoreItems
    // filters those out) — so residual is 0, nothing left to dispense.
    return match ?? { issuedThisWeek: 0, dispensedThisWeek: 0, residual: 0 };
  }

}
