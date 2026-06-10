// src/modules/store/store.controller.ts
// Egg intake and feed distribution endpoints removed.
// Store controller now exposes: summary, inventory, tally sign-off (via
// TallyVerificationController), purchase requests, HR, visitors.

import { Controller, Get, Patch, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { StoreService } from './store.service';

@ApiTags('store')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('store')
export class StoreController {
  constructor(private readonly svc: StoreService) {}

  @Get('summary')
  @RequirePermission(Permission.INVENTORY_VIEW)
  summary() { return this.svc.getStoreSummary(); }

  // Kept for backwards compatibility — tally service still calls cosignEggIntake
  @Patch('egg-intake/:id/cosign')
  @RequirePermission(Permission.PRODUCTION_VIEW)
  cosignIntake(@Param('id') id: string, @Request() req: any) { return this.svc.cosignEggIntake(id, req.user.id); }
}
