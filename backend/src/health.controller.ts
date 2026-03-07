import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './common/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    // Verify DB connection
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'AWFMS API',
      version: '1.0.0',
    };
  }
}
