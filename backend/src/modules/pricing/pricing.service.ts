import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';

export interface SetDailyPriceDto {
  priceDate: string;
  pricePerEgg: number;
  pricePerEggStarter?: number;
  pricePerEggBroken?: number;
  expectedRevenue?: number;
  notes?: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async setDailyPrice(dto: SetDailyPriceDto, user: RequestUser) {
    const existing = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: new Date(dto.priceDate) },
    });

    if (existing) {
      return this.prisma.dailyEggPrice.update({
        where: { priceDate: new Date(dto.priceDate) },
        data: {
          pricePerEgg: dto.pricePerEgg,
          pricePerEggStarter: dto.pricePerEggStarter ?? null,
          pricePerEggBroken: dto.pricePerEggBroken ?? null,
          expectedRevenue: dto.expectedRevenue ?? null,
          notes: dto.notes ?? null,
          setById: user.id,
        },
      });
    }

    return this.prisma.dailyEggPrice.create({
      data: {
        priceDate: new Date(dto.priceDate),
        pricePerEgg: dto.pricePerEgg,
        pricePerEggStarter: dto.pricePerEggStarter ?? null,
        pricePerEggBroken: dto.pricePerEggBroken ?? null,
        expectedRevenue: dto.expectedRevenue ?? null,
        notes: dto.notes ?? null,
        setById: user.id,
      },
    });
  }

  async getTodayPrice() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: today },
    });
  }

  async getPriceHistory(limit = 30) {
    return this.prisma.dailyEggPrice.findMany({
      orderBy: { priceDate: 'desc' },
      take: limit,
      include: {
        setBy: { select: { fullName: true, username: true } },
      },
    });
  }

  async getPriceForDate(date: string) {
    const price = await this.prisma.dailyEggPrice.findUnique({
      where: { priceDate: new Date(date) },
    });
    if (!price) throw new NotFoundException(`No price set for ${date}`);
    return price;
  }
}
