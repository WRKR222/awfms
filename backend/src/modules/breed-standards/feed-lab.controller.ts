// src/modules/breed-standards/feed-lab.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/types/request-user.type';
import { FeedLabInput, FeedLabService } from './feed-lab.service';

@Controller('feed-lab-tests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FeedLabController {
  constructor(private readonly service: FeedLabService) {}

  @Get('nutrients')
  @RequirePermission(Permission.FEED_LAB_TEST_VIEW)
  nutrients() { return this.service.nutrients(); }

  @Get('feed-items')
  @RequirePermission(Permission.FEED_LAB_TEST_VIEW)
  feedItems() { return this.service.feedItems(); }

  @Get()
  @RequirePermission(Permission.FEED_LAB_TEST_VIEW)
  list(@Query('storeItemId') storeItemId?: string) { return this.service.list(storeItemId); }

  @Post()
  @RequirePermission(Permission.FEED_LAB_TEST_MANAGE)
  create(@Body() body: FeedLabInput, @CurrentUser() user: RequestUser) { return this.service.create(body, user.id); }

  /** POST /feed-lab-tests/read — lab report PDF/photo → values to check (not saved). */
  @Post('read')
  @RequirePermission(Permission.FEED_LAB_TEST_MANAGE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  read(@UploadedFile() file: Express.Multer.File) { return this.service.readReport(file); }

  @Patch(':id')
  @RequirePermission(Permission.FEED_LAB_TEST_MANAGE)
  update(@Param('id') id: string, @Body() body: FeedLabInput) { return this.service.update(id, body); }

  @Delete(':id')
  @RequirePermission(Permission.FEED_LAB_TEST_MANAGE)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
