// src/modules/delivery/delivery.service.ts
import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

export interface CreateDeliveryDto {
  deliveryDate: string;          // YYYY-MM-DD
  route: string;                 // EMALI | NAIROBI_CBD | OTHER
  destination: string;
  customerId?: string;
  driverName?: string;
  vehiclePlate?: string;
  quantityTrays: number;
  notes?: string;
  salesOrderId?: string;
}

export interface UpdateDeliveryStatusDto {
  status: 'DELIVERED' | 'FAILED';
  failureReason?: string;
}

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateRef(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.deliveryLog.count();
    return `DL-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  async createDelivery(dto: CreateDeliveryDto, user: RequestUser) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer) throw new NotFoundException('Customer not found');
    }

    const deliveryRef = await this.generateRef();
    const quantityEggs = dto.quantityTrays * 30;

    return this.prisma.deliveryLog.create({
      data: {
        deliveryRef,
        deliveryDate: new Date(dto.deliveryDate),
        route: dto.route,
        destination: dto.destination,
        customerId: dto.customerId ?? null,
        driverName: dto.driverName ?? null,
        vehiclePlate: dto.vehiclePlate ?? null,
        quantityTrays: dto.quantityTrays,
        quantityEggs,
        notes: dto.notes ?? null,
        salesOrderId: dto.salesOrderId ?? null,
        loggedById: user.id,
        status: 'PENDING',
      },
      include: {
        customer: { select: { name: true, phone: true } },
        loggedBy: { select: { fullName: true } },
      },
    });
  }

  async getAllDeliveries(route?: string, status?: string, days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    return this.prisma.deliveryLog.findMany({
      where: {
        deliveryDate: { gte: from },
        ...(route ? { route } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        customer: { select: { name: true, phone: true } },
        loggedBy: { select: { fullName: true } },
        salesOrder: { select: { orderNumber: true } },
      },
      orderBy: [{ deliveryDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getDeliveryById(id: string) {
    const delivery = await this.prisma.deliveryLog.findUnique({
      where: { id },
      include: {
        customer: true,
        loggedBy: { select: { fullName: true } },
        salesOrder: { select: { orderNumber: true, subtotal: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery log not found');
    return delivery;
  }

  async updateDeliveryStatus(id: string, dto: UpdateDeliveryStatusDto, user: RequestUser) {
    const delivery = await this.prisma.deliveryLog.findUnique({ where: { id } });
    if (!delivery) throw new NotFoundException('Delivery log not found');
    if (delivery.status !== 'PENDING') {
      throw new BadRequestException(`Delivery is already marked as ${delivery.status}`);
    }
    if (dto.status === 'FAILED' && !dto.failureReason) {
      throw new BadRequestException('Failure reason is required when marking a delivery as failed');
    }

    return this.prisma.deliveryLog.update({
      where: { id },
      data: {
        status: dto.status,
        deliveredAt: dto.status === 'DELIVERED' ? new Date() : null,
        failureReason: dto.failureReason ?? null,
      },
      include: {
        customer: { select: { name: true, phone: true } },
      },
    });
  }

  async getDeliverySummary(days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);

    const all = await this.prisma.deliveryLog.findMany({
      where: { deliveryDate: { gte: from } },
    });

    const total       = all.length;
    const delivered   = all.filter(d => d.status === 'DELIVERED').length;
    const failed      = all.filter(d => d.status === 'FAILED').length;
    const pending     = all.filter(d => d.status === 'PENDING').length;
    const totalTrays  = all.reduce((s, d) => s + d.quantityTrays, 0);
    const emaliCount  = all.filter(d => d.route === 'EMALI').length;
    const emaliTrays  = all.filter(d => d.route === 'EMALI').reduce((s, d) => s + d.quantityTrays, 0);

    return { total, delivered, failed, pending, totalTrays, emaliCount, emaliTrays };
  }
}
