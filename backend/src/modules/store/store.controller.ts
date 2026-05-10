import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { StoreService, CreateStoreIntakeDto, LogFeedDistributionDto } from './store.service';

@ApiTags('store')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('store')
export class StoreController {
  constructor(private readonly svc: StoreService) {}

  @Get('summary')
  @RequirePermission(Permission.INVENTORY_VIEW)
  summary() { return this.svc.getStoreSummary(); }

  @Get('pending-intakes')
  @RequirePermission(Permission.INVENTORY_VIEW)
  pendingIntakes() { return this.svc.getPendingIntakes(); }

  @Post('egg-intake')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  createIntake(@Body() dto: CreateStoreIntakeDto, @Request() req: any) { return this.svc.createEggIntake(dto, req.user); }

  @Get('egg-intake')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getIntakes(@Query('houseId') houseId?: string, @Query('intakeDate') intakeDate?: string) {
    return this.svc.getEggIntakes(houseId, intakeDate);
  }

  @Patch('egg-intake/:id/cosign')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  cosignIntake(@Param('id') id: string, @Request() req: any) { return this.svc.cosignEggIntake(id, req.user.id); }

  @Get('egg-intake/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getIntake(@Param('id') id: string) { return this.svc.getIntakeById(id); }

  @Post('feed-distribution')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  logFeed(@Body() dto: LogFeedDistributionDto, @Request() req: any) { return this.svc.logFeedDistribution(dto, req.user); }

  @Get('feed-distribution')
  @RequirePermission(Permission.FEED_VIEW)
  getFeed(@Query('houseId') houseId?: string, @Query('entryDate') entryDate?: string) {
    return this.svc.getFeedDistributions(houseId, entryDate);
  }
}
