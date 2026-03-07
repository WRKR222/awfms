import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionKey } from '../permissions.constants';
import { RequestUser } from '../../auth/types/request-user.type';

/**
 * Guard that enforces RBAC permissions on every protected endpoint.
 *
 * How it works:
 * 1. Reads the @RequirePermission('key') metadata from the route
 * 2. Gets the current user (attached by JwtStrategy) from request
 * 3. Checks if the user's permissions array includes the required key
 * 4. Returns true (proceed) or throws ForbiddenException
 *
 * The user's permissions array is populated in JwtStrategy.validate()
 * from Redis cache (or DB on cache miss). Cache TTL: 1 hour.
 */
@Injectable()
export class RequirePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequirePermission decorator means open access (protected by JWT only)
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (!user.permissions.includes(requiredPermission)) {
      throw new ForbiddenException(
        `Permission '${requiredPermission}' is required for this action`,
      );
    }

    return true;
  }
}
