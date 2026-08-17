// src/modules/store/pm-requisition.dto.ts
import {
  IsString, IsOptional, IsArray, ValidateNested,
  IsNumber, Min, IsDateString, MaxLength, IsObject,
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

  /** Total for the week. If dailyBreakdown is also supplied, the service
   *  recomputes this as the sum of the daily figures — send your best total
   *  here regardless so a client that skips daily entry still works. */
  @Transform(toNum) @IsNumber() @Min(0.01)
  quantityNeeded: number;

  /** Day-specific amount needed from Store, straight off the weekly plan —
   *  e.g. { MON: 5, WED: 5, FRI: 10 }. Optional; omit for a flat weekly total. */
  @IsOptional()
  @IsObject()
  dailyBreakdown?: Record<string, number>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Upserts the current DRAFT requisition for the given week — reuses an
 * in-progress draft if one exists, or opens a new one. A week can have any
 * number of SUBMITTED requisitions (PM is not limited to one submission per
 * week); this only ever touches the single active DRAFT.
 */
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
