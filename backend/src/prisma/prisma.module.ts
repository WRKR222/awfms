import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Available everywhere without re-importing
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
