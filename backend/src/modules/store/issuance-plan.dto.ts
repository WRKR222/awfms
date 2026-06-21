import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsDateString, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class IssuancePlanItemDto {
  /** Present when editing an existing line item; omit for new items */
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  storeItemId: string;

  @IsNumber()
  @Min(0.001)
  quantityPlanned: number;

  @IsNumber()
  @Min(0)
  unitPriceKes: number;

  /** { MON, TUE, WED, THU, FRI, SAT, SUN } — omit for EMERGENCY items */
  @IsOptional()
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

  @IsNumber()
  @Min(0.1)
  gramsPerBirdPerDay: number;
}
