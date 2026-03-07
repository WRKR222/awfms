import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

/**
 * Catches all unhandled exceptions and returns consistent JSON error responses.
 * Never exposes internal stack traces in production.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string | string[]) ?? message;
        error = (resp.error as string) ?? exception.name;
      }
    } else if (exception instanceof ZodError) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
      error = 'Validation Error';
      message = exception.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    } else if (exception instanceof Error) {
      // Don't expose internal error details in production
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message;
      }
      this.logger.error(exception.message, exception.stack);
    }

    const body: ApiErrorResponse = {
      statusCode,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }
}
