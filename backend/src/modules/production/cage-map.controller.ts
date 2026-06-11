// src/modules/production/cage-map.controller.ts
import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';\nimport { CageMapService } from './cage-map.service';

@ApiTags('cage-map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('production/blocks')
export class CageMapController {
  constructor(private readonly svc: CageMapService) {}

  @Get()
  getAllBlocks() {
    return this.svc.getAllBlocks();
  }

  @Get(':code')
  getBlock(@Param('code') code: string) {
    return this.svc.getBlockWithMap(code.toUpperCase());
  }

  @Post(':code/rows/:rowId/assign')
  assignBatch(
    @Param('rowId') rowId: string,
    @Body() body: { batchId: string; transferDate: string; notes?: string },
    @Request() req: any,
  ) {
    return this.svc.assignBatchToRow(rowId, body.batchId, body.transferDate, body.notes, req.user.id);
  }

  @Delete(':code/rows/:rowId/assign')
  removeAssignment(@Param('rowId') rowId: string, @Request() req: any) {
    return this.svc.removeAssignment(rowId, req.user.id);
  }
}

/**
 * Separate lightweight controller at /cage-map for utility queries
 * (e.g. fetching row assignments for a specific batch — used by Farm Events form).
 */
@ApiTags('cage-map')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cage-map')
export class CageMapUtilController {
  constructor(private readonly svc: CageMapService) {}

  /**
   * GET /cage-map/assignments?batchId=<id>
   * Returns row-level assignments for a batch so the PM can pick a specific row
   * when logging CULLING or BIRD_MORTALITY for a production-house batch.
   */
  @Get('assignments')
  getAssignments(@Query('batchId') batchId: string) {
    return this.svc.getAssignmentsByBatch(batchId);
  }
}
