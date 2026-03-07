import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EntryStatus } from '@prisma/client';

export class VerifyEntryDto {
  @IsEnum([EntryStatus.APPROVED, EntryStatus.RETURNED])
  status: EntryStatus.APPROVED | EntryStatus.RETURNED;

  @IsOptional()
  @IsString()
  returnReason?: string; // required if status = RETURNED
}
