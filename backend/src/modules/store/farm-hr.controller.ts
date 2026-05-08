// src/modules/store/farm-hr.controller.ts
import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import {
  FarmHRService,
  CreateEmployeeDto,
  UpdateEmployeeDto,
  CreateConstructionDto,
  UpdateConstructionDto,
} from './farm-hr.service';

@ApiTags('farm-hr')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
@Controller('farm-hr')
export class FarmHRController {
  constructor(private readonly svc: FarmHRService) {}

  // ── Employees ─────────────────────────────────────────────────────────────────

  @Get('employees')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listEmployees(@Query('status') status?: string) {
    return this.svc.listEmployees(status);
  }

  @Get('employees/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getEmployee(@Param('id') id: string) {
    return this.svc.getEmployeeById(id);
  }

  @Post('employees')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.svc.createEmployee(dto);
  }

  @Patch('employees/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.svc.updateEmployee(id, dto);
  }

  // ── Construction Records ───────────────────────────────────────────────────────

  @Get('construction')
  @RequirePermission(Permission.INVENTORY_VIEW)
  listConstruction(@Query('status') status?: string) {
    return this.svc.listConstruction(status);
  }

  @Get('construction/:id')
  @RequirePermission(Permission.INVENTORY_VIEW)
  getConstruction(@Param('id') id: string) {
    return this.svc.getConstructionById(id);
  }

  @Post('construction')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  createConstruction(@Body() dto: CreateConstructionDto) {
    return this.svc.createConstruction(dto);
  }

  @Patch('construction/:id')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  updateConstruction(@Param('id') id: string, @Body() dto: UpdateConstructionDto) {
    return this.svc.updateConstruction(id, dto);
  }
}
