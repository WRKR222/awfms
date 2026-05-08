import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { Permission } from '../enums/permissions.enum';
import { RequestUser } from '../../auth/types/request-user.type';

@Injectable()
export class RequirePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser;

    if (!user) throw new ForbiddenException('Authentication required');

    const hasAll = required.every(p => user.permissions.includes(p));
    if (!hasAll) {
      throw new ForbiddenException(
        `Permission required: ${required.join(', ')}`,
      );
    }
    return true;
  }
}