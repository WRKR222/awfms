import {
  Injectable, UnauthorizedException, ConflictException, Logger, NotFoundException, ForbiddenException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;
  private readonly ACCESS_TOKEN_EXPIRY = '1h';
  private readonly REFRESH_TOKEN_EXPIRY = '7d';

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    // Case-insensitive username match: some mobile keyboards/browsers
    // auto-capitalize the first letter of a text input regardless of the
    // form's autoCapitalize="none" hint, so "James.attendant" and
    // "james.attendant" must both resolve to the same account rather than
    // failing with "Invalid credentials" purely because of which device
    // (and keyboard) the person typed it on.
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: dto.username, mode: 'insensitive' } },
      select: {
        id: true, username: true, email: true, passwordHash: true,
        role: true, fullName: true, houseIds: true, isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.generateTokens(user.id, user.username, user.role);

    this.logger.log(`Login: ${user.username} (${user.role})`);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        houseIds: user.houseIds,
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    // Guard: empty/missing token → 401 immediately (prevents Prisma validation error → 500)
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('Refresh token required');
    }

    let stored: any;
    try {
      stored = await this.prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });
    } catch {
      // Prisma error (e.g. DB schema mismatch, connection issue) → return 401 not 500
      this.logger.warn('refreshTokens: DB error during token lookup — treating as invalid');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedException('Account deactivated');
    }

    // Revoke old token (rotation)
    try {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Best-effort revocation — still issue new tokens
      this.logger.warn('refreshTokens: failed to revoke old token, continuing');
    }

    return this.generateTokens(stored.user.id, stored.user.username, stored.user.role);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  async createUser(dto: CreateUserDto, createdByRole: UserRole) {
    // Only OWNER can create users
    if (createdByRole !== UserRole.OWNER) {
      throw new UnauthorizedException('Only Farm Owner can create user accounts');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.email }],
      },
    });

    if (existing) {
      throw new ConflictException('Username or email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
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

    this.logger.log(`User created: ${user.username} (${user.role})`);
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password incorrect');

    const newHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.passwordResetLog.create({
        data: {
          adminId: userId,
          targetUserId: userId,
          resetType: 'SELF_CHANGE',
        },
      }),
    ]);
  }

  async adminResetPassword(adminId: string, targetUserId: string, newPassword: string) {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    const newHash = await bcrypt.hash(newPassword, this.BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { passwordHash: newHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.passwordResetLog.create({
        data: {
          adminId,
          targetUserId,
          resetType: 'ADMIN_RESET',
        },
      }),
    ]);
  }

  async getPasswordResetLog() {
    return this.prisma.passwordResetLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        admin: { select: { fullName: true, username: true, role: true } },
        targetUser: { select: { fullName: true, username: true, role: true } },
      },
    });
  }
  async getUsers(requesterId: string) {
    return this.prisma.user.findMany({
      where: { deletedAt: null, role: { not: UserRole.OWNER } },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        role: true,
        houseIds: true,
        createdAt: true,
        isActive: true,        
        lastLoginAt: true,
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
  }
  async updateUser(id: string, isActive: boolean) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });

    if (!target) throw new NotFoundException('User not found');

    if (target.role === UserRole.OWNER) {
      throw new ForbiddenException('The Director account cannot be disabled.');
    }

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, fullName: true, isActive: true, role: true },
    });
  }
  private async generateTokens(userId: string, username: string, role: UserRole) {
    const payload = { sub: userId, username, role };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });

    // Include a random jti so two tokens issued for the same user within the
    // same second (e.g. rapid double-click login, retried requests, two
    // tabs) are never byte-identical. JWTs are a deterministic function of
    // header+payload+secret+iat, so without a per-token nonce, two calls in
    // the same second previously produced the exact same signed string,
    // which then collided on the refresh_tokens.token unique constraint
    // (P2002) on the second INSERT.
    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh', jti: randomUUID() },
      { expiresIn: this.REFRESH_TOKEN_EXPIRY },
    );

    // Store refresh token in DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    try {
      await this.prisma.refreshToken.create({
        data: { userId, token: refreshToken, expiresAt },
      });
    } catch (err) {
      // Defense in depth: if a collision somehow still occurs (e.g. clock
      // skew across replicas, or this fix hasn't rolled out everywhere yet),
      // don't fail the login/refresh — re-sign once with a fresh jti/iat.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `generateTokens: refresh token collision for user ${userId}, retrying with new jti`,
        );
        const retryToken = this.jwtService.sign(
          { sub: userId, type: 'refresh', jti: randomUUID() },
          { expiresIn: this.REFRESH_TOKEN_EXPIRY },
        );
        await this.prisma.refreshToken.create({
          data: { userId, token: retryToken, expiresAt },
        });
        return { accessToken, refreshToken: retryToken };
      }
      throw err;
    }

    return { accessToken, refreshToken };
  }
}
