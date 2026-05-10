import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BatchLifecycleService } from './batch-lifecycle.service';
import { BatchStage } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  constructor(
    private readonly svc: FlockService,
    private readonly lifecycle: BatchLifecycleService,
  ) {}

  // ── Batches ────────────────────────────────────────────────────────────────
  @Get('batches')
  @RequirePermission(Permission.FLOCK_VIEW)
  @ApiOperation({ summary: 'List flock batches' })
  listBatches(
    @Query('isActive') isActive?: string,
    @Query('houseId') houseId?: string,
  ) {
    const active =
      isActive === undefined || isActive === '' ? undefined : isActive !== 'false';
    return this.svc.listBatches({ isActive: active, houseId });
  }

  @Get('batches/:id')
  @RequirePermission(Permission.FLOCK_VIEW)
  getBatch(@Param('id') id: string) {
    return this.svc.getBatch(id);
  }

  @Post('batches')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  @ApiOperation({ summary: 'Register a new flock batch' })
  createBatch(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createBatch(body, user.id);
  }

  // ── Daily entries ──────────────────────────────────────────────────────────
  @Get('entries/pending')
  @RequirePermission(Permission.FLOCK_VIEW)
  pendingEntries() {
    return this.svc.pendingEntries();
  }

  @Post('entries')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createEntry(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createEntry(body, user.id);
  }

  @Patch('entries/:id/verify')
  @RequirePermission(Permission.FLOCK_ENTRY_APPROVE)
  verifyEntry(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.verifyEntry(id, body, user.id);
  }

  // ── Batch stage transfer (Brooder → Production House) ─────────────────────
  @Patch('batches/:id/stage')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  @ApiOperation({ summary: 'Transfer batch to a new stage (e.g. BROODING → PRODUCTION)' })
  transferBatch(
    @Param('id') id: string,
    @Body('stage') stage: BatchStage,
    @Body('rowPlacements') rowPlacements: Array<{ rowId: string; birdCount: number }>,
    @CurrentUser() user: any,
  ) {
    return this.lifecycle.updateBatchStage(id, stage, user, rowPlacements);
  }

  // ── Culling ────────────────────────────────────────────────────────────────
  @Post('culling')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  logCulling(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.logCulling(body, user.id);
  }

  // ── Brooder logs ──────────────────────────────────────────────────────────
  @Get('brooder-logs')
  @RequirePermission(Permission.FLOCK_VIEW)
  listBrooderLogs(
    @Query('batchId') batchId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listBrooderLogs(batchId, limit ? Number(limit) : 50);
  }

  @Post('brooder-logs')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  createBrooderLog(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.createBrooderLog(body, user.id);
  }
}
