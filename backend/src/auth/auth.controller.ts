import {
  Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/enums/permissions.enum';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and receive JWT tokens' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission(Permission.USERS_MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users (Owner/Manager only)' })
  async getUsers(@CurrentUser() requester: any) {
    return this.authService.getUsers(requester.id);
  }

  @Post('users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission(Permission.USERS_MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new user account (Owner only)' })
  async createUser(@Body() dto: CreateUserDto, @CurrentUser() user: any) {
    return this.authService.createUser(dto, user.role);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change own password (all roles)' })
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: any) {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Post('admin-reset-password/:userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission(Permission.USERS_MANAGE)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Admin reset a user password (Owner/Manager only)' })
  async adminResetPassword(
    @Param('userId') userId: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() admin: any,
  ) {
    await this.authService.adminResetPassword(admin.id, userId, dto.newPassword);
  }

  @Get('password-reset-log')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission(Permission.USERS_MANAGE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'View password reset log (Owner/Manager only)' })
  async getPasswordResetLog() {
    return this.authService.getPasswordResetLog();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  async getMe(@CurrentUser() user: any) {
    return user;
  }
}
