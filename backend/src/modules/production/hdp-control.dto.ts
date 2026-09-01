// src/modules/production/hdp-control.dto.ts
//
// PM uploads a target Hen-Day Production % curve (a breed/standard control
// sheet) as PDF, Excel, or Word. It's parsed into (period, target %) points
// — period is a day number or week number of production, per `granularity`
// — and used to compare actual recorded HDP against the target.
import { z } from 'zod';

export const HdpControlGranularitySchema = z.enum(['DAILY', 'WEEKLY']);
export type HdpControlGranularityDto = z.infer<typeof HdpControlGranularitySchema>;

export const UploadHdpControlsSchema = z.object({
  granularity: HdpControlGranularitySchema,
  notes: z.string().optional(),
});
export type UploadHdpControlsDto = z.infer<typeof UploadHdpControlsSchema>;

/** One parsed (period, target %) point, before it's persisted. */
export interface ParsedHdpControlPoint {
  periodIndex: number;       // 1-based day or week number
  targetHdpPercent: number;  // 0–100
}
