import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../types/request-user.type';
import { PermissionKey } from '../../common/permissions.constants';

interface JwtPayload {
  sub: string;   // user ID
  username: string;
  roleId: string;
  roleName: string;
  houseId: string | null;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Called automatically after JWT signature is verified.
   * Loads user permissions and returns the RequestUser object.
   * This object is attached to request.user by Passport.
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    // Verify the user still exists and is active
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    const permissions = user.role.rolePermissions.map(
      rp => rp.permission.key as PermissionKey,
    );

    return {
      id: user.id,
      username: user.username,
      roleId: user.roleId,
      roleName: user.role.name,
      houseId: user.houseId,
      permissions,
    };
  }
}
