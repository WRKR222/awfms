import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ProductionService } from './production.service';
import {
  CreateProductionEntrySchema, CreateProductionEntryDto,
  ReturnProductionEntrySchema, ReturnProductionEntryDto,
} from './production.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequestUser } from '../../auth/types/request-user.type';
import { PERMISSIONS } from '../../common/permissions.constants';

@Controller()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  @Post('production-entries')
  @RequirePermission(PERMISSIONS.PRODUCTION_EGGS_LOG)
  @HttpCode(HttpStatus.CREATED)
  createEntry(
    @Body(new ZodValidationPipe(CreateProductionEntrySchema)) dto: CreateProductionEntryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productionService.createProductionEntry(dto, user);
  }

  @Get('production-entries/:batchId')
  @RequirePermission(PERMISSIONS.PRODUCTION_HENDAY_VIEW)
  getEntries(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.productionService.getProductionEntries(batchId);
  }

  @Patch('production-entries/:id/verify')
  @RequirePermission(PERMISSIONS.PRODUCTION_EGGS_APPROVE)
  verifyEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productionService.verifyProductionEntry(id, user);
  }

  @Patch('production-entries/:id/return')
  @RequirePermission(PERMISSIONS.PRODUCTION_EGGS_APPROVE)
  returnEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReturnProductionEntrySchema)) dto: ReturnProductionEntryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.productionService.returnProductionEntry(id, dto, user);
  }

  @Get('production-entries/:batchId/hen-day-trend')
  @RequirePermission(PERMISSIONS.PRODUCTION_HENDAY_VIEW)
  getHenDayTrend(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('days') days?: string,
  ) {
    return this.productionService.getHenDayTrend(batchId, days ? parseInt(days) : 14);
  }
}

@Module({
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
