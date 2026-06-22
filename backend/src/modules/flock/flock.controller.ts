import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { BatchLifecycleService } from './batch-lifecycle.service';
import { BatchStage } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FlockService } from './flock.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';

@ApiTags('Flock & Batches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('flock')
export class FlockController {
  constructor(private readonly svc: FlockService, private readonly lifecycle: BatchLifecycleService) {}

  @Get('houses')
  @RequirePermission(Permission.FLOCK_VIEW)
  listHouses(@Query('birdType') birdType?: string) { return this.svc.listHouses(birdType); }

  @Get('batches')
  @RequirePermission(Permission.FLOCK_VIEW)
  listBatches(@Query('isActive') isActive?: string, @Query('houseId') houseId?: string, @Query('stage') stage?: string) {
    const active = isActive === undefined || isActive === '' ? undefined : isActive !== 'false';
    return this.svc.listBatches({ isActive: active, houseId, stage });
  }

  @Get('batches/:id')
  @RequirePermission(Permission.FLOCK_VIEW)
  getBatch(@Param('id') id: string) { return this.svc.getBatch(id); }

  @Post('batches')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  createBatch(@Body() body: any, @CurrentUser() user: any) { return this.svc.createBatch(body, user.id); }

  // Correct registration details on an existing batch (supplier, bird type,
  // strain, dates, vaccination/transport notes, etc). quantityReceived ("Number
  // Received") is never editable here; location/stage changes go through the
  // dedicated transfer endpoint above.
  @Patch('batches/:id')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  updateBatch(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.updateBatch(id, body, user.id);
  }

  @Get('batches/:id/entries')
  @RequirePermission(Permission.FLOCK_VIEW)
  getBatchEntries(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getBatchEntries(id, limit ? Number(limit) : 50);
  }

  @Patch('batches/:id/stage')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  transferBatch(
    @Param('id') id: string,
    @Body('stage') stage: BatchStage,
    @Body('rowPlacements') rowPlacements: Array<{ rowId: string; birdCount: number }>,
    @CurrentUser() user: any,
  ) { return this.lifecycle.updateBatchStage(id, stage, user, rowPlacements); }

  @Get('entries/pending')
  @RequirePermission(Permission.FLOCK_VIEW)
  pendingEntries() { return this.svc.pendingEntries(); }

  @Post('entries')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createEntry(@Body() body: any, @CurrentUser() user: any) { return this.svc.createEntry(body, user.id); }

  @Patch('entries/:id/verify')
  @RequirePermission(Permission.FLOCK_ENTRY_APPROVE)
  verifyEntry(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.verifyEntry(id, body, user.id);
  }

  @Patch('entries/:id/return')
  @RequirePermission(Permission.FLOCK_ENTRY_APPROVE)
  returnEntry(@Param('id') id: string, @Body('returnReason') returnReason: string, @CurrentUser() user: any) {
    return this.svc.returnEntry(id, returnReason, user.id);
  }

  @Post('weight-samples')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  logWeightSample(@Body() body: any, @CurrentUser() user: any) { return this.svc.logWeightSample(body, user.id); }

  @Get('weight-samples/:batchId')
  @RequirePermission(Permission.FLOCK_VIEW)
  getWeightSamples(@Param('batchId') batchId: string, @Query('limit') limit?: string) {
    return this.svc.getWeightSamples(batchId, limit ? Number(limit) : 20);
  }

  @Post('culling')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  logCulling(@Body() body: any, @CurrentUser() user: any) { return this.svc.logCulling(body, user.id); }

  @Get('brooder-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listBrooderLogs(
    @Query('batchId') batchId: string,
    @Query('limit') limit?: string,
    @Query('rowId') rowId?: string,
    @Query('levelId') levelId?: string,
  ) {
    return this.svc.listBrooderLogs(batchId, limit ? Number(limit) : 50, rowId, levelId);
  }

  @Post('brooder-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createBrooderLog(@Body() body: any, @CurrentUser() user: any) { return this.svc.createBrooderLog(body, user.id); }
}
