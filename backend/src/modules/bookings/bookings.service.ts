import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

export interface CreateBookingDto {
  customerId: string;
  requestedDate: string;
  quantityTrays: number;
  eggType?: 'STANDARD_EGGS' | 'STARTER_EGGS' | 'CONSUMABLE_BROKEN_EGGS';
  requiresDelivery?: boolean;
  deliveryAddress?: string;
  deliveryDate?: string;
  notes?: string;
  // pricePerEggKes is intentionally NOT accepted from client — auto-resolved from DailyEggPrice
}

export interface CancelBookingDto {
  cancellationReason: string;
}

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateRef(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.advanceBooking.count();
    return `BK-${year}-${String(count + 1).padStart(3, '0')}`;
  }

  async createBooking(dto: CreateBookingDto, user: RequestUser) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    // Auto-resolve price from today's DailyEggPrice — salesperson never sets price manually
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pricing = await this.prisma.dailyEggPrice.findUnique({ where: { priceDate: today } });
    if (!pricing) throw new BadRequestException('No pricing set for today. Accountant must set daily prices before bookings can be created.');

    const eggType = dto.eggType ?? 'STANDARD_EGGS';
    let pricePerEggKes: number;
    if (eggType === 'STARTER_EGGS') {
      pricePerEggKes = pricing.pricePerEggStarter != null ? Number(pricing.pricePerEggStarter) : Number(pricing.pricePerEgg);
    } else if (eggType === 'CONSUMABLE_BROKEN_EGGS') {
      if (pricing.pricePerEggBroken == null) throw new BadRequestException('No price set for Consumable Broken Eggs today. Ask the accountant.');
      pricePerEggKes = Number(pricing.pricePerEggBroken);
    } else {
      pricePerEggKes = Number(pricing.pricePerEgg);
    }

    const quantityEggs  = dto.quantityTrays * 30;
    const estimatedTotal = quantityEggs * pricePerEggKes;
    const bookingRef    = await this.generateRef();

    const booking = await this.prisma.advanceBooking.create({
      data: {
        bookingRef,
        customerId:    dto.customerId,
        createdById:   user.id,
        requestedDate: new Date(dto.requestedDate),
        quantityTrays: dto.quantityTrays,
        quantityEggs,
        pricePerEggKes,   // auto-resolved from accountant's DailyEggPrice
        estimatedTotal,
        stockLocked: true,
        lockedAt:    new Date(),
        status:      'PENDING',
        notes:       dto.notes ?? null,
      },
      include: { customer: { select: { name: true, phone: true } } },
    });

    await this._notifyStockLocked(booking);
    return booking;
  }

  private async _notifyStockLocked(booking: any) {
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['STORE'] }, isActive: true },
      select: { id: true },
    });

    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type: 'STOCK_LOCKED_BOOKING' as any,
          title: `Stock Locked — ${booking.bookingRef}`,
          message: `${booking.customer.name} has booked ${booking.quantityTrays} trays (${booking.quantityEggs} eggs) for ${new Date(booking.requestedDate).toLocaleDateString('en-KE')}. Stock is now locked for this booking.`,
          entityId: booking.id,
          entityType: 'AdvanceBooking',
        },
      });
    }
  }

  async getAllBookings(status?: string) {
    return this.prisma.advanceBooking.findMany({
      where: status ? { status: status as any } : {},
      include: {
        customer: { select: { name: true, phone: true, email: true } },
      },
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
    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING bookings can be confirmed');
    }

    return this.prisma.advanceBooking.update({
      where: { id },
      data: { status: 'CONFIRMED' },
    });
  }

  async cancelBooking(id: string, dto: CancelBookingDto, user: RequestUser) {
    const booking = await this.prisma.advanceBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status === 'FULFILLED' || booking.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot cancel a ${booking.status} booking`);
    }

    const updated = await this.prisma.advanceBooking.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        stockLocked: false,
        unlockedAt: new Date(),
        cancellationReason: dto.cancellationReason,
      },
      include: { customer: { select: { name: true } } },
    });

    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['STORE'] }, isActive: true },
      select: { id: true },
    });
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type: 'BOOKING_CANCELLED' as any,
          title: `Booking Cancelled — ${booking.bookingRef}`,
          message: `Booking for ${updated.customer.name} (${booking.quantityTrays} trays) has been cancelled. Stock is now unlocked. Reason: ${dto.cancellationReason}`,
          entityId: booking.id,
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

    // Auto-generate order number
    const count = await this.prisma.salesOrder.count();
    const today = new Date();
    const pad = (n: number, d = 2) => String(n).padStart(d, '0');
    const datePart = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    const orderNumber = `SO-${datePart}-${String(count + 1).padStart(4, '0')}`;

    const totalTrays = booking.quantityTrays;
    const totalEggs = (booking as any).quantityEggs ?? (totalTrays * 30);
    const unitPrice = Number(booking.pricePerEggKes);
    const subtotal = totalEggs * unitPrice;

    // Create the SalesOrder and link it to the booking in a transaction
    const [salesOrder] = await this.prisma.$transaction([
      this.prisma.salesOrder.create({
        data: {
          orderNumber,
          tier: 'TIER_1' as any,
          paymentMethod: 'CASH' as any,
          customerId: booking.customerId,
          orderDate: today,
          subtotal,
          deliveryAddress: dto.deliveryAddress ?? null,
          notes: dto.notes ?? `Fulfilling advance booking ${booking.bookingRef}`,
          createdById: user.id,
          items: {
            create: [{
              itemType: 'EGGS',
              grade: null,
              quantityTrays: totalTrays,
              quantityEggs: totalEggs,
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

    // Mark booking as fulfilled and link the order
    const updatedBooking = await this.prisma.advanceBooking.update({
      where: { id },
      data: {
        status: 'FULFILLED',
        stockLocked: false,
        unlockedAt: new Date(),
        salesOrderId: salesOrder.id,
      },
      include: { customer: { select: { name: true } } },
    });

    // Notify Manager and Owner
    const targets = await this.prisma.user.findMany({
      where: { role: { in: ['STORE'] }, isActive: true },
      select: { id: true },
    });
    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          userId: t.id,
          type: 'BOOKING_FULFILLED' as any,
          title: `Booking Fulfilled — ${booking.bookingRef}`,
          message: `Advance booking for ${booking.customer.name} (${booking.quantityTrays} trays) has been fulfilled. Sales order ${orderNumber} created. Stock unlocked.`,
          entityId: booking.id,
          entityType: 'AdvanceBooking',
        },
      });
    }

    return { booking: updatedBooking, salesOrder };
  }

  async getLockedStockSummary() {
    const active = await this.prisma.advanceBooking.findMany({
      where: { stockLocked: true, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { customer: { select: { name: true } } },
      orderBy: { requestedDate: 'asc' },
    });

    return {
      activeBookings: active,
      totalLockedEggs:  active.reduce((s: number, b: any) => s + b.quantityEggs, 0),
      totalLockedTrays: active.reduce((s: number, b: any) => s + b.quantityTrays, 0),
    };
  }
}
