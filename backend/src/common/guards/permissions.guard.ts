import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';
import { Permission } from '../enums/permissions.enum';
import { ROLE_PERMISSIONS } from '../enums/role-permissions.map';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission decorator = public endpoint (shouldn't exist in AWFMS)
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Authentication required');

    const userPermissions = ROLE_PERMISSIONS[user.role] ?? [];
    const hasAll = required.every(p => userPermissions.includes(p));

    if (!hasAll) {
      throw new ForbiddenException(
        `Role '${user.role}' does not have required permission(s): ${required.join(', ')}`,
      );
    }
    return true;
  }
}
