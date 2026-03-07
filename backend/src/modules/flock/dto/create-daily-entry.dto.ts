import {
  IsString, IsEnum, IsInt, IsOptional, IsDateString, IsNumber, Min, Max,
} from 'class-validator';
import { MortalityCause } from '@prisma/client';

export class CreateDailyEntryDto {
  @IsString()
  batchId: string;

  @IsString()
  houseId: string;

  @IsDateString()
  entryDate: string;

  @IsEnum(['AM', 'PM'])
  shift: 'AM' | 'PM';

  @IsInt()
  @Min(0)
  openingCount: number;

  @IsInt()
  @Min(0)
  mortalityCount: number;

  @IsOptional()
  @IsEnum(MortalityCause)
  mortalityCause?: MortalityCause;

  @IsOptional()
  @IsInt()
  @Min(0)
  cullingCount?: number;

  @IsOptional()
  @IsString()
  cullingReason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  waterConsumptionL?: number;

  @IsOptional()
  @IsNumber()
  @Min(-5)
  @Max(50)
  temperatureCelsius?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidityPercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
