import {
  IsString, IsOptional, IsArray, ValidateNested,
  IsNumber, Min, IsDateString, IsEnum, IsObject,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

const toNum = ({ value }: { value: unknown }) => {
  const n = Number(value);
  return isFinite(n) ? n : 0;
};

export class IssuancePlanItemDto {
  /** Present when editing an existing line item; omit for new items */
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  storeItemId: string;

  @IsOptional()
  @Transform(toNum) @IsNumber() @Min(0)
  quantityPlanned?: number;

  @Transform(toNum) @IsNumber() @Min(0)
  unitPriceKes: number;

  /** { MON, TUE, WED, THU, FRI, SAT, SUN } — omit for EMERGENCY items */
  @IsOptional()
  @IsObject()
  dailyBreakdown?: Record<string, number>;

  @IsOptional()
  @IsString()
  notes?: string;

  /** MANUAL | PM_FEED_PLAN — preserved on edit; defaults to MANUAL for new items */
  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateIssuancePlanDto {
  @IsEnum(['WEEKLY', 'EMERGENCY'])
  type: 'WEEKLY' | 'EMERGENCY';

  /** ISO date string for the Monday of the target week */
  @IsDateString()
  weekStartDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Mandatory justification when type === 'EMERGENCY'; enforced in the service
   *  (not here) so the same DTO can serve WEEKLY plans, where it's irrelevant. */
  @IsOptional()
  @IsString()
  emergencyReason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssuancePlanItemDto)
  items: IssuancePlanItemDto[];
}

export class UpdateIssuancePlanDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  emergencyReason?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IssuancePlanItemDto)
  items?: IssuancePlanItemDto[];
}

/** Body for rejecting a single line item (POST .../items/:itemId/reject) */
export class RejectIssuancePlanItemDto {
  @IsString()
  rejectionReason: string;
}

export class SetFeedConsumptionPlanDto {
  /** ISO date string for Monday of the target week */
  @IsDateString()
  weekStartDate: string;

  /** BROODING | PRODUCTION */
  @IsString()
  stage: string;

  /** FeedType enum value e.g. CHICK_MASH */
  @IsString()
  feedType: string;

  @Transform(toNum) @IsNumber() @Min(0.1)
  gramsPerBirdPerDay: number;
}
