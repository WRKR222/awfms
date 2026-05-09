import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FeedService } from './feed.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { FeedType } from '@prisma/client';

@ApiTags('Feed Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Post('deliveries')
  @RequirePermission(Permission.FEED_DELIVERY_LOG)
  @ApiOperation({ summary: 'Log a feed delivery' })
  logDelivery(@Body() body: any, @CurrentUser() user: any) {
    return this.feedService.logDelivery(body, user.id);
  }

  @Get('deliveries')
  @RequirePermission(Permission.FEED_VIEW)
  @ApiOperation({ summary: 'Get recent feed deliveries' })
  getDeliveries(@Query('feedType') feedType?: FeedType, @Query('days') days?: number) {
    return this.feedService.getDeliveries(feedType, days ?? 30);
  }

  @Post('intake')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  @ApiOperation({ summary: 'Log daily feed intake for a batch' })
  logIntake(@Body() body: any, @CurrentUser() user: any) {
    return this.feedService.logIntake(body, user.id);
  }

  @Get('stock')
  @RequirePermission(Permission.FEED_STOCK_VIEW)
  @ApiOperation({ summary: 'Get current feed stock levels with days-remaining projection' })
  getCurrentStock(@Query('feedType') feedType?: FeedType) {
    return this.feedService.getCurrentStock(feedType);
  }

  // ── Feed Requests (Manager → Store) ──────────────────────────────────────
  @Get('requests')
  @RequirePermission(Permission.FEED_STOCK_VIEW)
  @ApiOperation({ summary: 'List feed requests' })
  listFeedRequests(@Query('status') status?: string) {
    return this.feedService.listFeedRequests(status);
  }

  @Post('requests')
  @RequirePermission(Permission.FEED_INTAKE_LOG)
  @ApiOperation({ summary: 'Create a feed request from Manager to Store' })
  createFeedRequest(@Body() body: any, @CurrentUser() user: any) {
    return this.feedService.createFeedRequest(body, user.id);
  }

  @Patch('requests/:id/issue')
  @RequirePermission(Permission.FEED_APPROVE)
  @ApiOperation({ summary: 'Issue / fulfill a feed request (Store)' })
  issueFeedRequest(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.feedService.issueFeedRequest(id, body, user.id);
  }
}
