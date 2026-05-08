import {
  Injectable, Controller, Get, Post, Patch, Body, Param,
  UseGuards, NotFoundException, ConflictException, Module,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/enums/permissions.enum';
import { RequestUser } from '../../auth/types/request-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true, username: true, email: true,
        role: true, fullName: true, houseIds: true,
        isActive: true, lastLoginAt: true, createdAt: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, username: true, email: true,
        role: true, fullName: true, houseIds: true,
        isActive: true, lastLoginAt: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: {
    username: string;
    email?: string;
    password: string;
    role: UserRole;
    fullName: string;
    houseIds?: string[];
  }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, ...(dto.email ? [{ email: dto.email }] : [])] },
    });
    if (existing) throw new ConflictException('Username or email already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email ?? `${dto.username}@awfms.local`,
        passwordHash,
        role: dto.role,
        fullName: dto.fullName,
        houseIds: dto.houseIds ?? [],
      },
      select: {
        id: true, username: true, email: true,
        role: true, fullName: true, houseIds: true, createdAt: true,
      },
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, username: true, isActive: true },
    });
  }

  async resetPassword(id: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: hash } });
    return { success: true };
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  getAll() { return this.usersService.findAll(); }

  @Get('me')
  getMe(@CurrentUser() user: RequestUser) {
    return this.usersService.findOne(user.id);
  }

  @Post()
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  create(@Body() dto: any) { return this.usersService.create(dto); }

  @Patch(':id/status')
  @RequirePermission(Permission.AI_REPORTS_VIEW)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.usersService.updateStatus(id, isActive);
  }
}

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}