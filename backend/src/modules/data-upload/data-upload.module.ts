// src/modules/data-upload/data-upload.module.ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DataUploadController } from './data-upload.controller';
import { DataUploadService }    from './data-upload.service';
import { PrismaModule }         from '../../common/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    MulterModule.register({ limits: { fileSize: 10 * 1024 * 1024 } }), // 10 MB max
  ],
  controllers: [DataUploadController],
  providers:   [DataUploadService],
  exports:     [DataUploadService],
})
export class DataUploadModule {}
