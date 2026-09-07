// src/modules/production/hdp-control.dto.ts
//
// PM uploads a target Hen-Day Production % curve (a breed/standard control
// sheet) as PDF, Excel, Word, or a photo/scan image (FIX — images are read
// with Claude's vision API, see AiService.transcribeHdpControlImage()).
// It's parsed into (period, target %) points — period is a day number or
// week number of production, per `granularity` — and used to compare actual
// recorded HDP against the target. `notes` is also used as context for the
// AI reader on image uploads (e.g. which breed/standard the sheet is).
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
