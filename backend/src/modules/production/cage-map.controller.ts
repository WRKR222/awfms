// src/modules/production/cage-map.controller.ts
import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CageMapService } from './cage-map.service';

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
