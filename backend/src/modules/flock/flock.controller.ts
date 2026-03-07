import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FlockService } from './flock.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { CreateDailyEntryDto } from './dto/create-daily-entry.dto';
import { VerifyEntryDto } from './dto/verify-entry.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { BatchStage } from '@prisma/client';

@ApiTags('Flock & Batch')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('flock')
export class FlockController {
  constructor(private readonly flockService: FlockService) {}

  // ── BATCHES ────────────────────────────────────────────────────────────────

  @Post('batches')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  @ApiOperation({ summary: 'Register a new batch (Manager/Owner only)' })
  createBatch(@Body() dto: CreateBatchDto, @CurrentUser() user: any) {
    return this.flockService.createBatch(dto, user.id);
  }

  @Get('batches')
  @RequirePermission(Permission.FLOCK_VIEW)
  @ApiOperation({ summary: 'List batches with optional filters' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'houseId', required: false, type: String })
  @ApiQuery({ name: 'stage', required: false, enum: BatchStage })
  getBatches(
    @Query('isActive') isActive?: boolean,
    @Query('houseId') houseId?: string,
    @Query('stage') stage?: BatchStage,
  ) {
    return this.flockService.getBatches({
      isActive: isActive !== undefined ? isActive : undefined,
      houseId,
      stage,
    });
  }

  @Get('batches/:id')
  @RequirePermission(Permission.FLOCK_VIEW)
  @ApiOperation({ summary: 'Get batch detail with recent entries' })
  getBatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.flockService.getBatchById(id);
  }

  // ── DAILY ENTRIES ──────────────────────────────────────────────────────────

  @Post('entries')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  @ApiOperation({ summary: 'Submit a daily flock entry (Attendant/Supervisor)' })
  createEntry(@Body() dto: CreateDailyEntryDto, @CurrentUser() user: any) {
    return this.flockService.createDailyEntry(dto, user.id, user.role);
  }

  @Get('entries/pending')
  @RequirePermission(Permission.FLOCK_VIEW)
  @ApiOperation({ summary: 'Get all pending entries for verification queue' })
  getPending(@CurrentUser() user: any) {
    return this.flockService.getPendingEntries(user.role, user.id);
  }

  @Get('entries/batch/:batchId')
  @RequirePermission(Permission.FLOCK_VIEW)
  @ApiOperation({ summary: 'Get recent entries for a specific batch' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  getEntriesForBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query('days') days?: number,
  ) {
    return this.flockService.getEntriesForBatch(batchId, days ?? 14);
  }

  @Patch('entries/:id/verify')
  @RequirePermission(Permission.FLOCK_ENTRY_APPROVE)
  @ApiOperation({ summary: 'Approve or return a pending entry (Supervisor/Manager/Owner)' })
  verifyEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyEntryDto,
    @CurrentUser() user: any,
  ) {
    return this.flockService.verifyEntry(id, dto, user.id, user.role);
  }

  // ── WEIGHT SAMPLES ─────────────────────────────────────────────────────────

  @Post('weight-samples')
  @RequirePermission(Permission.FLOCK_WEIGHT_LOG)
  @ApiOperation({ summary: 'Log a bird weight sample' })
  logWeightSample(
    @Body()
    body: {
      batchId: string;
      sampleDate: string;
      sampleCount: number;
      totalWeightG: number;
      notes?: string;
    },
    @CurrentUser() user: any,
  ) {
    return this.flockService.logWeightSample(
      body.batchId,
      body.sampleDate,
      body.sampleCount,
      body.totalWeightG,
      body.notes,
      user.id,
    );
  }
}
