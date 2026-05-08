import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { BookingsService, CreateBookingDto, CancelBookingDto } from './bookings.service';

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly svc: BookingsService) {}

  @Post()
  @RequirePermission(Permission.SALES_ORDER_CREATE)
  create(@Body() dto: CreateBookingDto, @Request() req: any) {
    return this.svc.createBooking(dto, req.user);
  }

  @Get()
  @RequirePermission(Permission.SALES_VIEW)
  findAll(@Query('status') status?: string) {
    return this.svc.getAllBookings(status);
  }

  @Get('locked-stock')
  @RequirePermission(Permission.INVENTORY_VIEW)
  lockedStock() {
    return this.svc.getLockedStockSummary();
  }

  @Get(':id')
  @RequirePermission(Permission.SALES_VIEW)
  findOne(@Param('id') id: string) {
    return this.svc.getBookingById(id);
  }

  @Patch(':id/confirm')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  confirm(@Param('id') id: string, @Request() req: any) {
    return this.svc.confirmBooking(id, req.user);
  }

  @Patch(':id/cancel')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @Request() req: any,
  ) {
    return this.svc.cancelBooking(id, dto, req.user);
  }

  @Patch(':id/fulfill')
  @RequirePermission(Permission.SALES_ORDER_MANAGE)
  fulfill(
    @Param('id') id: string,
    @Body() dto: { deliveryAddress?: string; notes?: string },
    @Request() req: any,
  ) {
    return this.svc.fulfillBooking(id, dto, req.user);
  }
}
