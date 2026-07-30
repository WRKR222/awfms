// src/modules/store/pm-requisition.dto.ts
import {
  IsString, IsOptional, IsArray, ValidateNested,
  IsNumber, Min, IsDateString, MaxLength,
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

  /** Set for a catalog item. Mutually exclusive with customItemName — the
   *  service rejects a line that has both or neither. */
  @IsOptional()
  @IsString()
  storeItemId?: string;

  /** Set instead of storeItemId when the item isn't in the Store catalog.
   *  Store reviews these manually — they never auto-fold into an Issuance
   *  Plan line the way catalog items do. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customItemName?: string;

  /** Optional free-text unit for a custom item (e.g. "bags", "rolls"). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customItemUnit?: string;

  @Transform(toNum) @IsNumber() @Min(0.01)
  quantityNeeded: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
