import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';

// Egg item types — matches SalesOrderItem.itemType values (no grade field used)
export type EggItemType =
  | 'STANDARD_EGGS'
  | 'STARTER_EGGS'
  | 'CONSUMABLE_BROKEN_EGGS';

const VALID_EGG_TYPES: EggItemType[] = [
  'STANDARD_EGGS', 'STARTER_EGGS', 'CONSUMABLE_BROKEN_EGGS',
];

const EGG_TYPE_LABELS: Record<EggItemType, string> = {
  STANDARD_EGGS:          'Standard Eggs',
  STARTER_EGGS:           'Starter Eggs',
  CONSUMABLE_BROKEN_EGGS: 'Consumable Broken Eggs',
};

export interface CreateBookingDto {
  customerId: string;
  eggType: EggItemType;        // Which egg category is being booked
  requestedDate: string;       // YYYY-MM-DD
  quantityTrays: number;
  requiresDelivery?: boolean;
  deliveryAddress?: string;
  deliveryDate?: string;       // YYYY-MM-DD
  notes?: string;
}

export interface CancelBookingDto {
  cancellationReason: string;
}

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateRef(): Promise<string> {
    const year  = new Date().getFullYear();
    const count = await this.prisma.advanceBooking.count();
    return `BK-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  async createBooking(dto: CreateBookingDto, user: RequestUser) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    if (!VALID_EGG_TYPES.includes(dto.eggType)) {
      throw new BadRequestException(
        `Invalid egg type "${dto.eggType}". Must be STANDARD_EGGS, STARTER_EGGS, or CONSUMABLE_BROKEN_EGGS`,
      );
    }
    if (dto.requiresDelivery && !dto.deliveryAddress?.trim()) {
      throw new BadRequestException('Delivery address is required when delivery is requested');
    }

    // Fetch today's pricing for price estimate (0 if no pricing today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });

    let pricePerEggKes = 0;
    if (pricing) {
      if      (dto.eggType === 'STANDARD_EGGS')          pricePerEggKes = Number(pricing.pricePerEgg);
      else if (dto.eggType === 'STARTER_EGGS')           pricePerEggKes = Number(pricing.pricePerEggStarter ?? pricing.pricePerEgg);
      else if (dto.eggType === 'CONSUMABLE_BROKEN_EGGS') pricePerEggKes = Number(pricing.pricePerEggBroken  ?? pricing.pricePerEgg);
    }

    const quantityEggs   = dto.quantityTrays * 30;
    const estimatedTotal = quantityEggs * pricePerEggKes;
    const bookingRef     = await this.generateRef();
    const eggTypeLabel   = EGG_TYPE_LABELS[dto.eggType];

    // Store egg type + delivery info in notes (schema has no dedicated eggType column yet)
    const noteParts = [
      `Egg Type: ${eggTypeLabel}`,
      dto.requiresDelivery ? `Delivery required to: ${dto.deliveryAddress}` : null,
      dto.deliveryDate     ? `Delivery date: ${dto.deliveryDate}` : null,
      dto.notes,
    ].filter(Boolean);

    const booking = await this.prisma.advanceBooking.create({
      data: {
        bookingRef,
        customerId:    dto.customerId,
        createdById:   user.id,
        requestedDate: new Date(dto.requestedDate),
        quantityTrays: dto.quantityTrays,
        quantityEggs,
        pricePerEggKes,
        estimatedTotal,
        stockLocked:   true,
        lockedAt:      new Date(),
        status:        'PENDING',
        notes:         noteParts.join(' | ') || null,
      },
      include: { customer: { select: { name: true, phone: true } } },
    });

    await this._notifyStockLocked(booking, eggTypeLabel);
    return booking;
  }

  private async _notifyStockLocked(booking: any, eggTypeLabel: string) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['STORE', 'MANAGER', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type:   'STOCK_LOCKED_BOOKING' as any,
          title:  `Stock Locked — ${booking.bookingRef}`,
          message: `${booking.customer.name} booked ${booking.quantityTrays} trays (${booking.quantityEggs} eggs) of ${eggTypeLabel} for ${dayjs(booking.requestedDate).format('D MMM YYYY')}. Stock locked.`,
          entityId:   booking.id,
          entityType: 'AdvanceBooking',
        },
      });
    }
  }

  async getAllBookings(status?: string) {
    return this.prisma.advanceBooking.findMany({
      where: status ? { status: status as any } : {},
      include: { customer: { select: { name: true, phone: true, email: true } } },
      orderBy: [{ status: 'asc' }, { requestedDate: 'asc' }],
    });
  }

  async getBookingById(id: string) {
    const b = await this.prisma.advanceBooking.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  async confirmBooking(id: string, user: RequestUser) {
    const booking = await this.prisma.advanceBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'PENDING') throw new BadRequestException('Only PENDING bookings can be confirmed');
    return this.prisma.advanceBooking.update({ where: { id }, data: { status: 'CONFIRMED' } });
  }

  async cancelBooking(id: string, dto: CancelBookingDto, user: RequestUser) {
    const booking = await this.prisma.advanceBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status === 'FULFILLED' || booking.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot cancel a ${booking.status} booking`);
    }

    const updated = await this.prisma.advanceBooking.update({
      where: { id },
      data: { status: 'CANCELLED', stockLocked: false, unlockedAt: new Date(), cancellationReason: dto.cancellationReason },
      include: { customer: { select: { name: true } } },
    });

    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['STORE', 'MANAGER', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type:   'BOOKING_CANCELLED' as any,
          title:  `Booking Cancelled — ${booking.bookingRef}`,
          message: `Booking for ${updated.customer.name} (${booking.quantityTrays} trays) cancelled. Stock unlocked. Reason: ${dto.cancellationReason}`,
          entityId:   booking.id,
          entityType: 'AdvanceBooking',
        },
      });
    }
    return updated;
  }

  async fulfillBooking(id: string, dto: { deliveryAddress?: string; notes?: string }, user: RequestUser) {
    const booking = await this.prisma.advanceBooking.findUnique({
      where: { id },
      include: { customer: { select: { name: true, phone: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException('Only CONFIRMED bookings can be fulfilled');
    }

    // Fetch today's pricing for accurate total at fulfillment
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
    if (!pricing) {
      throw new BadRequestException('No pricing set for today. Ask the accountant to set prices before fulfilling.');
    }

    // Determine egg type from notes (until schema gets a dedicated eggType column)
    const notesStr = ((booking.notes ?? '') as string);
    let eggType: EggItemType = 'STANDARD_EGGS';
    if      (notesStr.includes('Starter Eggs'))           eggType = 'STARTER_EGGS';
    else if (notesStr.includes('Consumable Broken Eggs')) eggType = 'CONSUMABLE_BROKEN_EGGS';

    let pricePerEgg = Number(pricing.pricePerEgg);
    if      (eggType === 'STARTER_EGGS'           && pricing.pricePerEggStarter) pricePerEgg = Number(pricing.pricePerEggStarter);
    else if (eggType === 'CONSUMABLE_BROKEN_EGGS' && pricing.pricePerEggBroken)  pricePerEgg = Number(pricing.pricePerEggBroken);

    const unitPrice = pricePerEgg * 30;      // price per tray
    const subtotal  = booking.quantityTrays * unitPrice;

    const count = await this.prisma.salesOrder.count();
    const today2  = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, '0');
    const datePart = `${today2.getFullYear()}${pad(today2.getMonth() + 1)}${pad(today2.getDate())}`;
    const orderNumber = `SO-${datePart}-${String(count + 1).padStart(4, '0')}`;

    const [salesOrder] = await this.prisma.$transaction([
      this.prisma.salesOrder.create({
        data: {
          orderNumber,
          customerId:      booking.customerId,
          orderDate:       today2,
          subtotal,
          deliveryAddress: dto.deliveryAddress ?? null,
          notes:           dto.notes ?? `Fulfilling advance booking ${booking.bookingRef}`,
          createdById:     user.id,
          status:          'CONFIRMED' as any,
          confirmedAt:     new Date(),
          items: {
            create: [{
              itemType:      eggType,       // e.g. 'STANDARD_EGGS' — no grade field
              quantityTrays: booking.quantityTrays,
              unitPrice,
              subtotal,
            }],
          },
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          items: true,
        },
      }),
    ]);

    const updatedBooking = await this.prisma.advanceBooking.update({
      where: { id },
      data: { status: 'FULFILLED', stockLocked: false, unlockedAt: new Date(), salesOrderId: salesOrder.id },
      include: { customer: { select: { name: true } } },
    });

    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'OWNER'] }, isActive: true },
      select: { id: true },
    });
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type:   'BOOKING_FULFILLED' as any,
          title:  `Booking Fulfilled — ${booking.bookingRef}`,
          message: `Advance booking for ${booking.customer.name} (${booking.quantityTrays} trays of ${EGG_TYPE_LABELS[eggType]}) fulfilled. Sales order ${orderNumber} created.`,
          entityId:   booking.id,
          entityType: 'AdvanceBooking',
        },
      });
    }

    return { booking: updatedBooking, salesOrder };
  }

  async getLockedStockSummary() {
    const active = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { in: ['PENDING', 'CONFIRMED'] as any[] } },
      include: { customer: { select: { name: true } } },
      orderBy: { requestedDate: 'asc' },
    });
    return {
      activeBookings:   active,
      totalLockedEggs:  active.reduce((s: number, b: any) => s + b.quantityEggs,  0),
      totalLockedTrays: active.reduce((s: number, b: any) => s + b.quantityTrays, 0),
    };
  }
}
