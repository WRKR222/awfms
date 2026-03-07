import { PermissionKey } from '../../common/permissions.constants';

/**
 * The user object attached to every authenticated request by JwtStrategy.
 * Access via @CurrentUser() decorator in controllers.
 */
export interface RequestUser {
  id: string;
  username: string;
  roleId: string;
  roleName: string;
  houseId: string | null;
  permissions: PermissionKey[];
}
