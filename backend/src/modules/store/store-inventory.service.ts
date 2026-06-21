// src/modules/store/store-inventory.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { NotificationType, UserRole } from '@prisma/client';
import { RequestUser } from '../../auth/types/request-user.type';
import { IssuancePlanService } from './issuance-plan.service';
import {
  IsString, IsOptional, IsNumber, IsBoolean, Min, IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export class CreateStoreItemDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  sku: string;

  @IsString() @IsNotEmpty()
  category: string;

  @IsString() @IsNotEmpty()
  unit: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  reorderLevel?: number;

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  unitCostKes?: number;

  @IsOptional() @IsString()
  supplierId?: string;
}

export class UpdateStoreItemDto {
  @IsOptional() @IsString() @IsNotEmpty()
  name?: string;

  @IsOptional() @IsString()
  category?: string;

  @IsOptional() @IsString()
  unit?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  reorderLevel?: number;

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  unitCostKes?: number;

  @IsOptional() @IsString()
  supplierId?: string;

  @IsOptional() @IsBoolean() @Type(() => Boolean)
  isActive?: boolean;
}

export interface StockInDto {
  storeItemId: string;
  receivedDate: string;
  quantityIn: number;
  unitCostKes: number;
  supplierName?: string;
  invoiceRef?: string;
  lpoId?: string;
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
        unit:         dto.unit as any,
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
        ...(dto.unit !== undefined ? { unit: dto.unit as any } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
        ...(dto.unitCostKes !== undefined ? { unitCostKes: dto.unitCostKes } : {}),
        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
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
          lpoId:        dto.lpoId ?? null,
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
        lpo:        { select: { lpoNumber: true } },
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
            type:       'REORDER_ALERT' as any,
            isRead:     false,
          },
        });
        if (!existing) {
          await this.prisma.notification.create({
            data: {
              userId:     u.id,
              type:       'REORDER_ALERT' as any,
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

}
