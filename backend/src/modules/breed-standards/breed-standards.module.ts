// src/modules/breed-standards/breed-standards.module.ts
import { Global, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BreedStandardService } from './breed-standard.service';
import { StandardComplianceService } from './standard-compliance.service';
import { BreedGuideUploadService } from './breed-guide-upload.service';
import { BreedStandardsController } from './breed-standards.controller';
import { BreedStandardsCron } from './breed-standards.cron';

/** Core services (band resolution, compliance, AI context) only need Prisma
 *  and notifications, so they are global — AiService, FlockService,
 *  HdpControlService and WeightAlertService inject them without import cycles. */
@Global()
@Module({
  providers: [BreedStandardService, StandardComplianceService],
  exports: [BreedStandardService, StandardComplianceService],
})
export class BreedStandardsCoreModule {}

@Module({
  imports: [AiModule],
  controllers: [BreedStandardsController],
  providers: [BreedGuideUploadService, BreedStandardsCron],
})
export class BreedStandardsModule {}
