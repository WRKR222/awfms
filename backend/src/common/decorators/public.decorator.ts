import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * Marks an endpoint as public — bypasses JWT authentication.
 * Use for: login, refresh token, health check endpoints.
 *
 * @example
 * @Public()
 * @Post('login')
 * login(...) {}
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
