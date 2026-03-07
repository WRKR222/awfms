import {
  Injectable, Controller, Get, Post, Patch, Body, Param,
  UseGuards, NotFoundException, ConflictException, Module,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissionGuard } from '../../common/guards/require-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequestUser } from '../../auth/types/request-user.type';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/permissions.constants';

// ── DTOs ──────────────────────────────────────────────────────────────────────
const CreateUserSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-z0-9._-]+$/, 'Lowercase letters, numbers, dots, dashes only'),
  email: z.string().email().optional(),
  password: z.string().min(8).max(72).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain uppercase, lowercase, and a number',
  ),
  roleId: z.string().uuid(),
  houseId: z.string().uuid().optional(),
});
type CreateUserDto = z.infer<typeof CreateUserSchema>;

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  houseId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  roleId: z.string().uuid().optional(),
});
type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    'Password must contain uppercase, lowercase, and a number',
  ),
});
type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

// ── Service ───────────────────────────────────────────────────────────────────
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true, username: true, email: true, isActive: true,
        lastLoginAt: true, houseId: true, createdAt: true,
        role: { select: { name: true, displayName: true } },
        house: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, username: true, email: true, isActive: true,
        lastLoginAt: true, houseId: true, createdAt: true, updatedAt: true,
        role: { select: { name: true, displayName: true } },
        house: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { username: dto.username },
    });
    if (existing) throw new ConflictException(`Username '${dto.username}' is already taken`);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    return this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        passwordHash,
        roleId: dto.roleId,
        houseId: dto.houseId,
      },
      select: {
        id: true, username: true, email: true, isActive: true, createdAt: true,
        role: { select: { name: true, displayName: true } },
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findById(id);
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: {
        id: true, username: true, email: true, isActive: true,
        role: { select: { name: true } },
        house: { select: { name: true } },
      },
    });
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new ConflictException('Current password is incorrect');

    const newHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: newHash },
    });
    return { message: 'Password changed successfully' };
  }

  async getRoles() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' } });
  }
}

// ── Controller ────────────────────────────────────────────────────────────────
@Controller('users')
@UseGuards(JwtAuthGuard, RequirePermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SETTINGS_USERS_MANAGE)
  findAll() { return this.usersService.findAll(); }

  @Get('roles')
  @RequirePermission(PERMISSIONS.AUTH_PROFILE_VIEW)
  getRoles() { return this.usersService.getRoles(); }

  @Get(':id')
  @RequirePermission(PERMISSIONS.SETTINGS_USERS_MANAGE)
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SETTINGS_USERS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SETTINGS_USERS_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  @Patch('me/change-password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(ChangePasswordSchema)) dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(user.id, dto);
  }
}

// ── Module ────────────────────────────────────────────────────────────────────
@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
