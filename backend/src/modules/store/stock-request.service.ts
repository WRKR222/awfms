// src/modules/store/stock-request.service.ts
// SimpleStockRequest — PM/Sales/Accountant ask Store for items already in stock.
// Distinct from PurchaseRequest (Store → Accountant → LPO → Director).

import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

const REQUESTER_ROLES = new Set(['MANAGER', 'SALES', 'ACCOUNTANT', 'OWNER']);
const FULFILLER_ROLES = new Set(['STORE', 'OWNER']);

export interface CreateSimpleStockRequestDto {
  neededBy?: string;
  purpose?: string;
  notes?: string;
  items: Array<{ storeItemId: string; quantityRequested: number; notes?: string }>;
}

export interface FulfillDto {
  // What was actually issued (defaults to requested if omitted)
  issued: Array<{ itemId: string; quantityIssued: number; }>;
  notes?: string;
}

@Injectable()
export class StockRequestService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSimpleStockRequestDto, user: RequestUser) {
    if (!REQUESTER_ROLES.has(user.role)) {
      throw new ForbiddenException('Your role cannot raise simple stock requests');
    }
    if (!dto.items?.length) throw new BadRequestException('At least one item required');

    const count = await this.prisma.simpleStockRequest.count();
    const requestRef = `SSR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.simpleStockRequest.create({
      data: {
        requestRef,
        requestDate: new Date(),
        neededBy: dto.neededBy ? new Date(dto.neededBy) : null,
        purpose: dto.purpose ?? null,
        notes: dto.notes ?? null,
        requestedById: user.id,
        items: {
          create: dto.items.map(i => ({
            storeItemId: i.storeItemId,
            quantityRequested: i.quantityRequested,
            notes: i.notes ?? null,
          })),
        },
      },
      include: { items: true },
    });
  }

  async list(status?: string, mine = false, user?: RequestUser) {
    return this.prisma.simpleStockRequest.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(mine && user ? { requestedById: user.id } : {}),
      },
      include: {
        items: { include: { storeItem: { select: { name: true, sku: true, unit: true, currentStock: true } } } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        fulfilledBy: { select: { id: true, fullName: true } },
      },
      orderBy: { requestDate: 'desc' },
      take: 100,
    });
  }

  async get(id: string) {
    const req = await this.prisma.simpleStockRequest.findUnique({
      where: { id },
      include: {
        items: { include: { storeItem: true, stockOut: true } },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        fulfilledBy: { select: { id: true, fullName: true } },
      },
    });
    if (!req) throw new NotFoundException('Stock request not found');
    return req;
  }

  async fulfill(id: string, dto: FulfillDto, user: RequestUser) {
    if (!FULFILLER_ROLES.has(user.role)) {
      throw new ForbiddenException('Only Store may fulfill stock requests');
    }
    const req = await this.prisma.simpleStockRequest.findUnique({
      where: { id }, include: { items: true },
    });
    if (!req) throw new NotFoundException('Stock request not found');
    if (req.status !== 'PENDING') throw new BadRequestException(`Request is already ${req.status}`);

    const today = new Date(); today.setHours(0, 0, 0, 0);

    return this.prisma.$transaction(async (tx) => {
      let allFull = true;
      let anyIssued = false;

      for (const reqItem of req.items) {
        const issuedRow = dto.issued.find(i => i.itemId === reqItem.id);
        const qtyIssued = Number(issuedRow?.quantityIssued ?? reqItem.quantityRequested);
        if (qtyIssued <= 0) { allFull = false; continue; }
        anyIssued = true;
        if (qtyIssued < Number(reqItem.quantityRequested)) allFull = false;

        const item = await tx.storeItem.findUnique({ where: { id: reqItem.storeItemId } });
        if (!item) throw new NotFoundException(`Store item ${reqItem.storeItemId} not found`);
        if (Number(item.currentStock) < qtyIssued) {
          throw new BadRequestException(`Insufficient stock for ${item.name} (have ${item.currentStock}, need ${qtyIssued})`);
        }

        const stockOut = await tx.storeStockOut.create({
          data: {
            storeItemId: item.id,
            issuedDate: today,
            quantityOut: qtyIssued,
            unitCostKes: item.unitCostKes,
            totalCostKes: Number(item.unitCostKes) * qtyIssued,
            purpose: req.purpose ?? `SimpleStockRequest ${req.requestRef}`,
            notes: dto.notes ?? null,
            issuedById: user.id,
          },
        });

        await tx.storeItem.update({
          where: { id: item.id },
          data: { currentStock: { decrement: qtyIssued } },
        });

        await tx.simpleStockRequestItem.update({
          where: { id: reqItem.id },
          data: { quantityIssued: qtyIssued, stockOutId: stockOut.id },
        });
      }

      const status = !anyIssued ? 'REJECTED' : (allFull ? 'ISSUED' : 'PARTIAL');
      const updated = await tx.simpleStockRequest.update({
        where: { id },
        data: {
          status,
          fulfilledById: user.id,
          fulfilledAt: new Date(),
        },
      });

      await tx.notification.create({
        data: {
          userId: req.requestedById,
          type: 'STOCK_REQUEST_FULFILLED' as any,
          title: `Stock request ${status.toLowerCase()}`,
          message: `Your stock request ${req.requestRef} has been ${status.toLowerCase()} by Store.`,
          entityId: id,
          entityType: 'SimpleStockRequest',
        },
      });
      return updated;
    });
  }

  async cancel(id: string, user: RequestUser) {
    const req = await this.prisma.simpleStockRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Stock request not found');
    if (req.requestedById !== user.id && user.role !== 'OWNER') {
      throw new ForbiddenException('Only the requester may cancel this request');
    }
    if (req.status !== 'PENDING') throw new BadRequestException('Cannot cancel — already processed');
    return this.prisma.simpleStockRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }
}
