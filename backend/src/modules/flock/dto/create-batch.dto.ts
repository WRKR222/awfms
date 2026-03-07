import {
  IsString, IsEnum, IsInt, IsDateString, IsOptional, IsBoolean, Min,
} from 'class-validator';
import { BirdType } from '@prisma/client';

export class CreateBatchDto {
  @IsString()
  batchCode: string;

  @IsString()
  supplierId: string;

  @IsString()
  houseId: string;

  @IsEnum(BirdType)
  birdType: BirdType;

  @IsString()
  strain: string;

  @IsInt()
  @Min(1)
  quantityReceived: number;

  @IsDateString()
  dateOfHatch: string;

  @IsDateString()
  dateReceived: string;

  @IsOptional()
  @IsBoolean()
  vaccinationOnArrival?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  mortalityOnArrival?: number;

  @IsOptional()
  @IsString()
  transportConditions?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
