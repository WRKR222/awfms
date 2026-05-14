// src/modules/store/store-inventory.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateStoreItemDto {
  name: string;
  sku: string;
  category: string;
  unit: string;
  description?: string;
  reorderLevel?: number;
  unitCostKes?: number;
  supplierId?: string;
}

export interface UpdateStoreItemDto {
  name?: string;
  category?: string;
  unit?: string;
  description?: string;
  reorderLevel?: number;
  unitCostKes?: number;
  supplierId?: string;
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
  issuedToName?: string;       // GAP-04: person name who receives the stock
  issuedToHouseId?: string;
  issuedToBatchId?: string;
  purpose?: string;
  notes?: string;
}

export interface CreatePurchaseRequestDto {
  requestDate: string;
  urgency?: 'LOW' | 'NORMAL' | 'URGENT';
  notes?: string;
  items: Array<{
    storeItemId: string;
    quantityRequested: number;
    estimatedUnitCost?: number;
    reason?: string;
  }>;
}

export interface ReviewPurchaseRequestDto {
  status: 'REVIEWED' | 'REJECTED';
  reviewNotes?: string;
}

export interface CreateLPODto {
  purchaseRequestId?: string;
  supplierId?: string;
  supplierName: string;
  lpoDate: string;
  expectedDelivery?: string;
  notes?: string;
  items: Array<{
    storeItemId?: string;
    description?: string;
    quantity: number;
    unitPrice: number;
  }>;
  vatPercent?: number;
}

export interface UpdateLPOStatusDto {
  status: string;
}

// ─── SERVICE ─────────────────────────────────────────────────────────────────

@Injectable()
export class StoreInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Ref generators ──────────────────────────────────────────────────────────

  private async generateRequestRef(): Promise<string> {
    const count = await this.prisma.purchaseRequest.count();
    const seq = String(count + 1).padStart(4, '0');
    const year = new Date().getFullYear();
    return `PR-${year}-${seq}`;
  }

  private async generateLPONumber(): Promise<string> {
    const count = await this.prisma.localPurchaseOrder.count();
    const seq = String(count + 1).padStart(4, '0');
    const year = new Date().getFullYear();
    return `LPO-${year}-${seq}`;
  }

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

    const totalCostKes = dto.quantityOut * Number(item.unitCostKes);

    // Use interactive transaction so we can capture the updated item (GAP-05)
    const { stockOut, updatedItem } = await this.prisma.$transaction(async (tx) => {
      const so = await tx.storeStockOut.create({
        data: {
          storeItemId:     dto.storeItemId,
          issuedDate:      new Date(dto.issuedDate),
          quantityOut:     dto.quantityOut,
          unitCostKes:     item.unitCostKes,
          totalCostKes,
          issuedToName:    dto.issuedToName ?? null,    // GAP-04
          issuedToHouseId: dto.issuedToHouseId ?? null,
          issuedToBatchId: dto.issuedToBatchId ?? null,
          purpose:         dto.purpose ?? null,
          notes:           dto.notes ?? null,
          issuedById:      user.id,
        },
      });

      const ui = await tx.storeItem.update({
        where: { id: dto.storeItemId },
        data: { currentStock: { decrement: dto.quantityOut } },
      });

      return { stockOut: so, updatedItem: ui };
    });

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

  // ── Purchase Requests ─────────────────────────────────────────────────────────

  async createPurchaseRequest(dto: CreatePurchaseRequestDto, user: RequestUser) {
    const requestRef = await this.generateRequestRef();

    return this.prisma.purchaseRequest.create({
      data: {
        requestRef,
        requestDate: new Date(dto.requestDate),
        urgency:     dto.urgency ?? 'NORMAL',
        notes:       dto.notes ?? null,
        createdById: user.id,
        status:      'DRAFT',
        items: {
          create: dto.items.map((item) => ({
            storeItemId:        item.storeItemId,
            quantityRequested:  item.quantityRequested,
            estimatedUnitCost:  item.estimatedUnitCost ?? 0,
            reason:             item.reason ?? null,
          })),
        },
      },
      include: { items: { include: { storeItem: true } } },
    });
  }

  async submitPurchaseRequest(id: string, user: RequestUser) {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Purchase request not found');
    if (pr.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT requests can be submitted');
    }
    if (pr.createdById !== user.id) {
      throw new BadRequestException('You can only submit your own purchase requests');
    }

    const updated = await this.prisma.purchaseRequest.update({
      where: { id },
      data: { status: 'SUBMITTED' },
      include: { items: { include: { storeItem: { select: { name: true } } } } },
    });

    // Notify Accountants
    const accountants = await this.prisma.user.findMany({
      where: { role: 'ACCOUNTANT', isActive: true },
      select: { id: true },
    });
    for (const a of accountants) {
      await this.prisma.notification.create({
        data: {
          userId:     a.id,
          type:       'PURCHASE_REQUEST',
          title:      `Purchase Request ${updated.requestRef}`,
          message:    `A new purchase request has been submitted for review.`,
          entityId:   id,
          entityType: 'PurchaseRequest',
        },
      });
    }

    return updated;
  }

  async reviewPurchaseRequest(id: string, dto: ReviewPurchaseRequestDto, user: RequestUser) {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException('Purchase request not found');
    if (pr.status !== 'SUBMITTED') {
      throw new BadRequestException('Only SUBMITTED requests can be reviewed');
    }

    return this.prisma.purchaseRequest.update({
      where: { id },
      data: {
        status:      dto.status as any,
        reviewNotes: dto.reviewNotes ?? null,
        reviewedById: user.id,
        reviewedAt:  new Date(),
      },
      include: { items: { include: { storeItem: true } } },
    });
  }

  async listPurchaseRequests(status?: string) {
    return this.prisma.purchaseRequest.findMany({
      where: status ? { status: status as any } : {},
      include: {
        createdBy:  { select: { fullName: true, role: true } },
        reviewedBy: { select: { fullName: true } },
        items: { include: { storeItem: { select: { name: true, unit: true } } } },
        lpo:  { select: { lpoNumber: true, status: true } },
      },
      orderBy: { requestDate: 'desc' },
    });
  }

  async getPurchaseRequestById(id: string) {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        createdBy:  { select: { fullName: true, role: true } },
        reviewedBy: { select: { fullName: true } },
        items: { include: { storeItem: true } },
        lpo:  true,
      },
    });
    if (!pr) throw new NotFoundException('Purchase request not found');
    return pr;
  }

  // ── Local Purchase Orders ─────────────────────────────────────────────────────

  async createLPO(dto: CreateLPODto, user: RequestUser) {
    const lpoNumber = await this.generateLPONumber();

    const subtotalKes = dto.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const vatPercent  = dto.vatPercent ?? 0;
    const vatKes      = subtotalKes * (vatPercent / 100);
    const totalKes    = subtotalKes + vatKes;

    if (dto.purchaseRequestId) {
      const pr = await this.prisma.purchaseRequest.findUnique({
        where: { id: dto.purchaseRequestId },
      });
      if (!pr) throw new NotFoundException('Purchase request not found');
      if (pr.status !== 'REVIEWED') {
        throw new BadRequestException('Purchase request must be REVIEWED before an LPO can be created');
      }
    }

    const lpo = await this.prisma.localPurchaseOrder.create({
      data: {
        lpoNumber,
        purchaseRequestId: dto.purchaseRequestId ?? null,
        supplierId:        dto.supplierId ?? null,
        supplierName:      dto.supplierName,
        lpoDate:           new Date(dto.lpoDate),
        expectedDelivery:  dto.expectedDelivery ? new Date(dto.expectedDelivery) : null,
        status:            'DRAFT',
        subtotalKes,
        vatKes,
        totalKes,
        notes:             dto.notes ?? null,
        createdById:       user.id,
        items: {
          create: dto.items.map((item) => ({
            storeItemId: item.storeItemId ?? null,
            description: item.description ?? null,
            quantity:    item.quantity,
            unitPrice:   item.unitPrice,
            subtotal:    item.quantity * item.unitPrice,
          })),
        },
      },
      include: {
        items: { include: { storeItem: { select: { name: true, unit: true } } } },
        purchaseRequest: { select: { requestRef: true } },
      },
    });

    if (dto.purchaseRequestId) {
      await this.prisma.purchaseRequest.update({
        where: { id: dto.purchaseRequestId },
        data: { status: 'LPO_RAISED' },
      });
    }

    return lpo;
  }

  async submitLPO(id: string) {
    const lpo = await this.prisma.localPurchaseOrder.findUnique({ where: { id } });
    if (!lpo) throw new NotFoundException('LPO not found');
    if (lpo.status !== 'DRAFT') throw new BadRequestException('Only DRAFT LPOs can be submitted');

    const updated = await this.prisma.localPurchaseOrder.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isActive: true },
      select: { id: true },
    });
    for (const o of owners) {
      await this.prisma.notification.create({
        data: {
          userId:     o.id,
          type:       'LPO_SUBMITTED',
          title:      `LPO ${lpo.lpoNumber} submitted for approval`,
          message:    `LPO for ${lpo.supplierName} (KES ${lpo.totalKes.toFixed(2)}) is awaiting your approval.`,
          entityId:   id,
          entityType: 'LocalPurchaseOrder',
        },
      });
    }

    return updated;
  }

  async approveLPO(id: string, user: RequestUser) {
    const lpo = await this.prisma.localPurchaseOrder.findUnique({ where: { id } });
    if (!lpo) throw new NotFoundException('LPO not found');
    if (lpo.status !== 'SUBMITTED') throw new BadRequestException('Only SUBMITTED LPOs can be approved');

    const updated = await this.prisma.localPurchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id, approvedAt: new Date() },
    });

    const notifyRoles = ['ACCOUNTANT', 'STORE'] as const;
    for (const role of notifyRoles) {
      const users = await this.prisma.user.findMany({
        where: { role, isActive: true },
        select: { id: true },
      });
      for (const u of users) {
        await this.prisma.notification.create({
          data: {
            userId:     u.id,
            type:       'LPO_APPROVED',
            title:      `LPO ${lpo.lpoNumber} approved`,
            message:    `LPO for ${lpo.supplierName} has been approved. Proceed with purchase.`,
            entityId:   id,
            entityType: 'LocalPurchaseOrder',
          },
        });
      }
    }

    return updated;
  }

  async rejectLPO(id: string, rejectionReason: string, user: RequestUser) {
    const lpo = await this.prisma.localPurchaseOrder.findUnique({ where: { id } });
    if (!lpo) throw new NotFoundException('LPO not found');
    if (lpo.status !== 'SUBMITTED') throw new BadRequestException('Only SUBMITTED LPOs can be rejected');
    if (!rejectionReason?.trim()) throw new BadRequestException('Rejection reason is required');

    const updated = await this.prisma.localPurchaseOrder.update({
      where: { id },
      data: { status: 'REJECTED' as any, notes: `REJECTED: ${rejectionReason.trim()}${lpo.notes ? ` | ${lpo.notes}` : ''}` },
    });

    // Notify the accountant who created it
    const creator = await this.prisma.user.findUnique({ where: { id: lpo.createdById }, select: { id: true } });
    if (creator) {
      await this.prisma.notification.create({
        data: {
          userId:     creator.id,
          type:       'LPO_REJECTED' as any,
          title:      `LPO ${lpo.lpoNumber} rejected`,
          message:    `LPO for ${lpo.supplierName} was rejected by ${user.fullName ?? 'Owner'}. Reason: ${rejectionReason.trim()}`,
          entityId:   id,
          entityType: 'LocalPurchaseOrder',
        },
      });
    }

    return updated;
  }

  async listLPOs(status?: string) {
    return this.prisma.localPurchaseOrder.findMany({
      where: status ? { status: status as any } : {},
      include: {
        createdBy:       { select: { fullName: true } },
        approvedBy:      { select: { fullName: true } },
        purchaseRequest: { select: { requestRef: true } },
        items: { include: { storeItem: { select: { name: true, unit: true } } } },
      },
      orderBy: { lpoDate: 'desc' },
    });
  }

  async getLPOById(id: string) {
    const lpo = await this.prisma.localPurchaseOrder.findUnique({
      where: { id },
      include: {
        createdBy:       { select: { fullName: true } },
        approvedBy:      { select: { fullName: true } },
        purchaseRequest: { include: { items: { include: { storeItem: true } } } },
        supplier:        true,
        items:           { include: { storeItem: true } },
        stockIns:        true,
      },
    });
    if (!lpo) throw new NotFoundException('LPO not found');
    return lpo;
  }
}
