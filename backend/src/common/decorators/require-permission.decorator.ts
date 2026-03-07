import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permissions.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to protect any route with RBAC.
 * Usage: @RequirePermission(Permission.FLOCK_ENTRY_CREATE)
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
