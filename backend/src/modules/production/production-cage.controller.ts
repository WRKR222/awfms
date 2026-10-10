// src/modules/production/production-cage.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { ProductionCageService } from './production-cage.service';

@ApiTags('production-houses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('production/houses')
export class ProductionCageController {
  constructor(private readonly svc: ProductionCageService) {}

  /** Both houses with dimensions and free space (used by the transfer modal). */
  @Get()
  @RequirePermission(Permission.FLOCK_VIEW)
  list() {
    return this.svc.listHouses();
  }

  /** PM: move all or some birds of a brooder batch into Block 1 or Block 2. */
  @Post('transfer')
  @RequirePermission(Permission.FLOCK_BATCH_MANAGE)
  transfer(@Body() body: any, @Request() req: any) {
    return this.svc.transferFromBrooder(body, req.user);
  }

  @Get(':code/map')
  @RequirePermission(Permission.FLOCK_VIEW)
  map(@Param('code') code: string) {
    return this.svc.getHouseMap(code.toUpperCase());
  }

  @Get(':code/mortality')
  @RequirePermission(Permission.FLOCK_VIEW)
  mortality(@Param('code') code: string, @Query('days') days?: string) {
    return this.svc.listCageMortality(code.toUpperCase(), days ? Number(days) : 30);
  }

  @Post(':code/cages/assign')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  assign(@Param('code') code: string, @Body() body: any, @Request() req: any) {
    return this.svc.assignCages(code.toUpperCase(), body, req.user.id);
  }

  @Post(':code/cages/fill')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  fill(@Param('code') code: string, @Body() body: any, @Request() req: any) {
    return this.svc.fillCages(code.toUpperCase(), body, req.user.id);
  }

  @Delete(':code/cages/:cageCode')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  remove(@Param('code') code: string, @Param('cageCode') cageCode: string, @Request() req: any) {
    return this.svc.removeCage(code.toUpperCase(), cageCode, req.user.id);
  }

  @Get(':code/reassignments')
  @RequirePermission(Permission.FLOCK_VIEW)
  reassignments(@Param('code') code: string) {
    return this.svc.listReassignments(code);
  }

  /** Shows what a plain-words reassignment would change, without saving. */
  @Post(':code/reassignments/preview')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  preview(@Param('code') code: string, @Body() body: any) {
    return this.svc.previewReassignment(code, body);
  }

  @Post(':code/reassignments')
  @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
  record(@Param('code') code: string, @Body() body: any, @Request() req: any) {
    return this.svc.recordReassignment(code, body, req.user.id);
  }
}
