import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Permission } from '../../common/enums/permissions.enum';
import { ROLE_PERMISSIONS } from '../../common/enums/role-permissions.map';
import { RequestUser } from '../types/request-user.type';

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
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

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    const permissions: Permission[] = ROLE_PERMISSIONS[user.role] ?? [];

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      houseIds: user.houseIds,
      permissions,
    };
  }
}