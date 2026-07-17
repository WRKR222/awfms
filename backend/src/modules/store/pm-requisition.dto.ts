// src/modules/store/pm-requisition.dto.ts
import {
  IsString, IsOptional, IsArray, ValidateNested,
  IsNumber, Min, IsDateString,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const toNum = ({ value }: { value: unknown }) => {
  const n = Number(value);
  return isFinite(n) ? n : 0;
};

export class PMRequisitionItemDto {
  /** Present when editing an existing line item; omit for new items */
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  storeItemId: string;

  @Transform(toNum) @IsNumber() @Min(0.01)
  quantityNeeded: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** Upserts the DRAFT requisition for the given week — creates one if none exists yet. */
export class SavePMRequisitionDraftDto {
  /** ISO date string for the Monday of the target (coming) week */
  @IsDateString()
  weekStartDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PMRequisitionItemDto)
  items: PMRequisitionItemDto[];
}
