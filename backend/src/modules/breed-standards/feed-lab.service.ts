// src/modules/breed-standards/feed-lab.service.ts
//
// Store records each feed's laboratory nutrient analysis. Values are kept
// AS FED: a dry-matter report is converted with its moisture result, and
// energy given in MJ/kg is converted to kcal/kg. A result applies to the feed
// from `effectiveFrom` until a newer test replaces it. Saving re-scores the
// active batches so nutrient comparisons show up straight away.
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StoreItemCategory } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { FEED_NUTRIENTS, NUTRIENT_BY_KEY } from './feed-nutrients.catalog';
import { StandardComplianceService, canonicalFeedType } from './standard-compliance.service';

const FEED_CATEGORIES: StoreItemCategory[] = [StoreItemCategory.FEED, StoreItemCategory.FEED_SUPPLEMENT];
const MJ_TO_KCAL = 239.006;

export interface FeedLabInput {
  storeItemId?: string;
  feedFamily?: string | null;
  stockInId?: string | null;
  labName?: string | null;
  sampleRef?: string | null;
  sampleDate?: string;
  resultDate?: string | null;
  effectiveFrom?: string | null;
  values?: Record<string, number | string | null>;
  basis?: 'AS_FED' | 'DRY_MATTER';
  energyUnit?: 'KCAL' | 'MJ';
  reportFileName?: string | null;
  aiInterpretation?: string | null;
  notes?: string | null;
}

const day = (s: string) => {
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date "${s}"`);
  return d;
};

/** Validates and normalises lab values to AS FED, kcal/kg. */
export function normaliseLabValues(raw: Record<string, any>, basis: 'AS_FED' | 'DRY_MATTER' = 'AS_FED', energyUnit: 'KCAL' | 'MJ' = 'KCAL') {
  const values: Record<string, number> = {};
  for (const [key, v] of Object.entries(raw ?? {})) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const n = NUTRIENT_BY_KEY.get(key);
    if (!n) throw new BadRequestException(`Unknown nutrient "${key}"`);
    let num = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) throw new BadRequestException(`${n.label}: enter a number of 0 or more`);
    if (key === 'ENERGY' && energyUnit === 'MJ') num *= MJ_TO_KCAL;
    if (n.concUnit === '%' && num > 100) throw new BadRequestException(`${n.label}: a percentage cannot be over 100`);
    if (key === 'ENERGY' && (num < 1000 || num > 5000)) throw new BadRequestException(`Energy ${Math.round(num)} kcal/kg looks wrong — feeds are usually 2,500–3,200 kcal/kg (or 10.5–13.4 MJ/kg)`);
    values[key] = num;
  }
  if (basis === 'DRY_MATTER') {
    const moisture = values.MOISTURE;
    if (moisture == null) throw new BadRequestException('Dry-matter results need the moisture % to convert them to as-fed');
    const factor = (100 - moisture) / 100;
    for (const k of Object.keys(values)) if (k !== 'MOISTURE') values[k] = values[k] * factor;
  }
  for (const k of Object.keys(values)) values[k] = Math.round(values[k] * 10000) / 10000;
  if (!Object.keys(values).some(k => NUTRIENT_BY_KEY.get(k)?.compared)) {
    throw new BadRequestException('Enter at least one nutrient the guide compares (e.g. crude protein, lysine, calcium, energy)');
  }
  return values;
}

@Injectable()
export class FeedLabService {
  private readonly logger = new Logger(FeedLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly compliance: StandardComplianceService,
  ) {}

  nutrients() {
    return FEED_NUTRIENTS.map(({ key, label, concUnit, compared }) => ({ key, label, unit: concUnit, compared }));
  }

  async feedItems() {
    const items = await this.prisma.storeItem.findMany({
      where: { category: { in: FEED_CATEGORIES }, isActive: true },
      select: { id: true, name: true, unit: true, category: true },
      orderBy: { name: 'asc' },
    });
    const latest = await this.prisma.feedLabTest.findMany({
      where: { deletedAt: null, storeItemId: { in: items.map(i => i.id) } },
      orderBy: { effectiveFrom: 'desc' },
      distinct: ['storeItemId'],
      select: { storeItemId: true, effectiveFrom: true, sampleDate: true },
    });
    const byItem = new Map(latest.map(l => [l.storeItemId, l]));
    return items.map(i => ({ ...i, feedFamily: canonicalFeedType(i.name), latestTest: byItem.get(i.id) ?? null }));
  }

  async list(storeItemId?: string) {
    return this.prisma.feedLabTest.findMany({
      where: { deletedAt: null, ...(storeItemId ? { storeItemId } : {}) },
      include: { storeItem: { select: { id: true, name: true, unit: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async create(input: FeedLabInput, userId: string) {
    const item = await this.feedItem(input.storeItemId);
    if (!input.sampleDate) throw new BadRequestException('Give the date the sample was taken');
    const sampleDate = day(input.sampleDate);
    const test = await this.prisma.feedLabTest.create({
      data: {
        storeItemId: item.id,
        feedFamily: input.feedFamily || canonicalFeedType(item.name),
        stockInId: input.stockInId || null,
        labName: input.labName?.trim() || null,
        sampleRef: input.sampleRef?.trim() || null,
        sampleDate,
        resultDate: input.resultDate ? day(input.resultDate) : null,
        effectiveFrom: input.effectiveFrom ? day(input.effectiveFrom) : sampleDate,
        values: normaliseLabValues(input.values ?? {}, input.basis, input.energyUnit),
        reportedBasis: input.basis === 'DRY_MATTER' ? 'DRY_MATTER' : 'AS_FED',
        reportFileName: input.reportFileName || null,
        aiInterpretation: input.aiInterpretation || null,
        notes: input.notes?.trim() || null,
        recordedById: userId,
      },
      include: { storeItem: { select: { id: true, name: true, unit: true } } },
    });
    this.rescore();
    return test;
  }

  async update(id: string, input: FeedLabInput) {
    const existing = await this.prisma.feedLabTest.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Lab test not found');
    const data: any = {};
    if (input.storeItemId) { const item = await this.feedItem(input.storeItemId); data.storeItemId = item.id; data.feedFamily = input.feedFamily || canonicalFeedType(item.name); }
    else if (input.feedFamily !== undefined) data.feedFamily = input.feedFamily || null;
    for (const k of ['labName', 'sampleRef', 'notes', 'stockInId'] as const) if (input[k] !== undefined) data[k] = input[k] ? String(input[k]).trim() : null;
    if (input.sampleDate) data.sampleDate = day(input.sampleDate);
    if (input.resultDate !== undefined) data.resultDate = input.resultDate ? day(input.resultDate) : null;
    if (input.effectiveFrom) data.effectiveFrom = day(input.effectiveFrom);
    if (input.values) {
      data.values = normaliseLabValues(input.values, input.basis, input.energyUnit);
      data.reportedBasis = input.basis === 'DRY_MATTER' ? 'DRY_MATTER' : 'AS_FED';
    }
    const test = await this.prisma.feedLabTest.update({
      where: { id }, data, include: { storeItem: { select: { id: true, name: true, unit: true } } },
    });
    this.rescore();
    return test;
  }

  async remove(id: string) {
    const existing = await this.prisma.feedLabTest.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Lab test not found');
    await this.prisma.feedLabTest.update({ where: { id }, data: { deletedAt: new Date() } });
    this.rescore();
    return { removed: true };
  }

  /** Reads a lab report (PDF/photo) into form values for Store to check. */
  async readReport(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    if (!['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new BadRequestException('Upload the lab report as PDF or a photo (png/jpg/webp)');
    const read = await this.ai.readFeedLabReport(file.buffer, mime, FEED_NUTRIENTS.map(n => ({ key: n.key, label: n.label, unit: n.concUnit })));
    if (!read) throw new BadRequestException('The report could not be read automatically — please type the results in.');
    return { ...read, reportFileName: file.originalname };
  }

  private async feedItem(storeItemId?: string) {
    if (!storeItemId) throw new BadRequestException('Choose the feed that was tested');
    const item = await this.prisma.storeItem.findUnique({ where: { id: storeItemId } });
    if (!item) throw new NotFoundException('Feed item not found');
    if (!FEED_CATEGORIES.includes(item.category)) throw new BadRequestException(`${item.name} is not a feed item`);
    return item;
  }

  private rescore() {
    this.compliance.evaluateActiveBatches().catch(err => this.logger.warn(`Re-scoring after lab test change failed: ${err?.message}`));
  }
}
