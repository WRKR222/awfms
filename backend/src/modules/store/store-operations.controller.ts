// src/modules/store/store-operations.controller.ts
import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import {
  StoreOperationsService,
  LogMedicationDto,
  LogEquipmentDto,
  LogVetVisitDto,
  LogWorkerAssignmentDto,
} from './store-operations.service';

@ApiTags('store-operations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('store/operations')
export class StoreOperationsController {
  constructor(private readonly svc: StoreOperationsService) {}

  // ── Medication ─────────────────────────────────────────────────────────────

  @Post('medication-logs')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  logMedication(@Body() dto: LogMedicationDto, @Request() req: any) {
    return this.svc.logMedication(dto, req.user);
  }

  @Get('medication-logs')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getMedication(
    @Query('batchId') batchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getMedicationLogs(batchId, from, to);
  }

  @Delete('medication-logs/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  deleteMedication(@Param('id') id: string) {
    return this.svc.deleteMedicationLog(id);
  }

  // ── Equipment ──────────────────────────────────────────────────────────────

  @Post('equipment-logs')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  logEquipment(@Body() dto: LogEquipmentDto, @Request() req: any) {
    return this.svc.logEquipment(dto, req.user);
  }

  @Get('equipment-logs')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getEquipment(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getEquipmentLogs(from, to);
  }

  @Delete('equipment-logs/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  deleteEquipment(@Param('id') id: string) {
    return this.svc.deleteEquipmentLog(id);
  }

  // ── Vet Visits ─────────────────────────────────────────────────────────────

  @Post('vet-visits')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  logVetVisit(@Body() dto: LogVetVisitDto, @Request() req: any) {
    return this.svc.logVetVisit(dto, req.user);
  }

  @Get('vet-visits')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getVetVisits(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.getVetVisitLogs(from, to);
  }

  @Delete('vet-visits/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  deleteVetVisit(@Param('id') id: string) {
    return this.svc.deleteVetVisitLog(id);
  }

  // ── Worker Assignments ─────────────────────────────────────────────────────

  @Post('worker-assignments')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  logWorker(@Body() dto: LogWorkerAssignmentDto, @Request() req: any) {
    return this.svc.logWorkerAssignment(dto, req.user);
  }

  @Get('worker-assignments')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getWorkers(
    @Query('weekStartDate') weekStartDate?: string,
    @Query('houseId') houseId?: string,
  ) {
    return this.svc.getWorkerAssignments(weekStartDate, houseId);
  }

  @Delete('worker-assignments/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  deleteWorker(@Param('id') id: string) {
    return this.svc.deleteWorkerAssignment(id);
  }

  // ── Cost Summary (Accountant/Director) ────────────────────────────────────

  @Get('cost-summary')
  @RequirePermission(Permission.FINANCE_VIEW)
  getCostSummary(
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.svc.getOperationsCostSummary(from, to);
  }
}
