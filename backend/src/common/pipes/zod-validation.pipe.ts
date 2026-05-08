import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validation pipe that uses Zod schemas for request body/param/query validation.
 * Usage: @Body(new ZodValidationPipe(mySchema)) in controller methods.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!this.schema) return value;
    if (metadata.type !== 'body') return value;

    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
          error: 'Validation Failed',
        });
      }
      throw error;
    }
  }
}
