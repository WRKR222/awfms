import {
  Controller, Get, Post, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { PricingService, SetDailyPriceDto } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pricing')
export class PricingController {
  constructor(private readonly svc: PricingService) {}

  @Post('daily')
  @RequirePermission(Permission.PRICING_MANAGE)
  setPrice(@Body() dto: SetDailyPriceDto, @Request() req: any) {
    return this.svc.setDailyPrice(dto, req.user);
  }

  @Get('daily/today')
  @RequirePermission(Permission.SALES_VIEW)
  today() {
    return this.svc.getTodayPrice();
  }

  @Get('daily/history')
  @RequirePermission(Permission.PRICING_MANAGE)
  history(@Query('limit') limit?: string) {
    return this.svc.getPriceHistory(limit ? Number(limit) : 30);
  }

  @Get('daily/:date')
  @RequirePermission(Permission.SALES_VIEW)
  byDate(@Param('date') date: string) {
    return this.svc.getPriceForDate(date);
  }
}
