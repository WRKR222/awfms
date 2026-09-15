import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';

// FIX: this interceptor existed but was never registered anywhere (not in
// main.ts, not as an APP_INTERCEPTOR provider) — every request, from every
// account, left zero trace in Railway logs. Now wired up globally in main.ts.
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const now = Date.now();

    const who = () => {
      const u = req.user;
      return u ? `${u.username}(${u.role})` : 'anon';
    };

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        this.logger.log(`${method} ${url} → ${res.statusCode} [${Date.now() - now}ms] user=${who()} ip=${ip}`);
      }),
      // FIX: tap() only fires on success — a thrown exception (validation
      // error, DB crash, network drop mid-request) would otherwise never
      // be logged by this interceptor at all.
      catchError((err) => {
        const status = err?.status ?? err?.getStatus?.() ?? 500;
        this.logger.warn(`${method} ${url} → ${status} [${Date.now() - now}ms] user=${who()} ip=${ip} err=${err?.message ?? err}`);
        return throwError(() => err);
      }),
    );
  }
}
