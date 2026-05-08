import { Permission } from '../../common/enums/permissions.enum';
import { UserRole } from '@prisma/client';

/**
 * The user object attached to every authenticated request by JwtStrategy.
 * Access via @CurrentUser() decorator in controllers.
 */
export interface RequestUser {
  id: string;
  username: string;
  role: UserRole;
  fullName: string;
  houseIds: string[];
  permissions: Permission[];
}