// src/modules/breed-standards/breed-standard.service.ts
//
// Breeds, guide versions and "what is the standard for this batch, this
// parameter, at this age". Everything that compares a record with a breed
// guide asks resolveBand() — it picks the batch's breed and active guide
// edition, applies an approved farm standard on top, and follows the guide's
// last row once the batch is older than the guide where that makes sense.
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { BirdType, NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../../common/notifications/notifications.service';
import { METRICS, MetricDefinition, metricDef, noInputMetrics, recordableMetrics } from './breed-metrics.catalog';
import { GuidePointInput, GuideSeed, HYLINE_BROWN_2024 } from './guides/hyline-brown-2024.guide';

export type AgeUnit = 'WEEK' | 'DAY';

export interface StandardPoint {
  metric: string;
  variant: string | null;
  ageUnit: string;
  ageFrom: number;
  ageTo: number;
  min: number | null;
  target: number | null;
  max: number | null;
  unit: string | null;
  label: string | null;
  phase: string | null;
  text: string | null;
}

export interface ResolvedBand {
  metric: string;
  min: number | null;
  target: number | null;
  max: number | null;
  unit: string | null;
  label: string | null;
  phase: string | null;
  text: string | null;
  /** GUIDE | GUIDE_EXTENDED (past the guide's last row) | FARM */
  basis: 'GUIDE' | 'GUIDE_EXTENDED' | 'FARM';
  guideId: string;
  farmStandardId: string | null;
  /** The guide's own band (same as min/target/max unless a farm standard applies). */
  guide: { min: number | null; target: number | null; max: number | null };
}

export interface BatchStandardContext {
  batchId: string;
  batchCode: string;
  breedId: string | null;
  breedName: string | null;
  variety: string | null;
  guide: { id: string; title: string; versionLabel: string; versionYear: number; variety: string | null } | null;
  dateOfHatch: Date;
  dateReceived: Date;
  housingType: string;
  nutritionProgram: string;
  untracked: Set<string>;
}

export const HOUSING_TYPES = ['LIGHT_CONTROLLED', 'OPEN_SIDED'] as const;
export const NUTRITION_PROGRAMS = ['ECONOMICAL', 'OPTIMAL', 'BOTH'] as const;

const num = (v: any): number | null => (v == null ? null : Number(v));

export function normaliseBreedText(s: string | null | undefined): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class BreedStandardService implements OnModuleInit {
  private readonly logger = new Logger(BreedStandardService.name);
  // Points of an ACTIVE/ARCHIVED guide never change, so they are cached.
  private readonly pointCache = new Map<string, StandardPoint[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    try {
      await this.seedGuide(HYLINE_BROWN_2024);
      await this.backfillBatchBreeds();
    } catch (err: any) {
      // Never block app start-up over reference data.
      this.logger.error(`Breed guide seeding skipped: ${err?.message}`);
    }
  }

  // ── Seeding ─────────────────────────────────────────────────────────────

  /** Idempotent: creates the breed and guide edition if missing, and makes
   *  it ACTIVE when the breed has no active guide for that variety yet. */
  async seedGuide(seed: GuideSeed) {
    const breed = await this.prisma.breed.upsert({
      where: { code: seed.breed.code },
      create: { code: seed.breed.code, name: seed.breed.name, birdType: seed.breed.birdType as BirdType, aliases: seed.breed.aliases },
      update: {},
    });
    const existing = await this.prisma.breedGuide.findFirst({
      where: { breedId: breed.id, versionLabel: seed.guide.versionLabel, variety: seed.guide.variety },
      select: { id: true, sourceKind: true },
    });
    if (existing) {
      // A seeded edition picks up parameters added to the seed file later
      // (existing parameters are never rewritten).
      if (existing.sourceKind === 'SEED') {
        const have = new Set((await this.prisma.breedStandardPoint.findMany({
          where: { guideId: existing.id }, distinct: ['metric'], select: { metric: true },
        })).map(r => r.metric));
        const missing = seed.points.filter(p => !have.has(p.metric));
        if (missing.length) {
          await this.insertPoints(existing.id, missing);
          this.pointCache.delete(existing.id);
          this.logger.log(`Added ${missing.length} new point(s) to ${seed.breed.name} — ${seed.guide.versionLabel}`);
        }
      }
      return existing.id;
    }

    const hasActive = await this.prisma.breedGuide.count({
      where: { breedId: breed.id, variety: seed.guide.variety, status: 'ACTIVE' },
    });
    const guide = await this.prisma.breedGuide.create({
      data: {
        breedId: breed.id,
        ...seed.guide,
        status: hasActive ? 'DRAFT' : 'ACTIVE',
        sourceKind: 'SEED',
        activatedAt: hasActive ? null : new Date(),
      },
    });
    await this.insertPoints(guide.id, seed.points);
    this.logger.log(`Seeded breed guide ${seed.breed.name} — ${seed.guide.versionLabel} (${seed.points.length} points)`);
    return guide.id;
  }

  async insertPoints(guideId: string, points: GuidePointInput[]) {
    const start = await this.prisma.breedStandardPoint.count({ where: { guideId } });
    const rows = points.map((p, i) => ({
      guideId,
      seq: start + i,
      metric: p.metric,
      variant: p.variant ?? null,
      ageUnit: p.ageUnit ?? 'WEEK',
      ageFrom: p.ageFrom,
      ageTo: p.ageTo ?? p.ageFrom,
      minValue: p.min ?? null,
      targetValue: p.target ?? null,
      maxValue: p.max ?? null,
      unit: p.unit ?? null,
      label: p.label ?? null,
      phase: p.phase ?? null,
      textValue: p.text ?? null,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await this.prisma.breedStandardPoint.createMany({ data: rows.slice(i, i + 500) });
    }
  }

  /** Links every batch without a breed to one whose aliases match its strain. */
  async backfillBatchBreeds() {
    const batches = await this.prisma.batch.findMany({
      where: { breedId: null, deletedAt: null },
      select: { id: true, strain: true, notes: true },
    });
    let linked = 0;
    for (const b of batches) {
      // Older registrations kept the typed breed only in notes ("Bird breed: …").
      const breedText = /Bird breed:\s*(.+)/i.exec(b.notes ?? '')?.[1] ?? '';
      const match = (await this.matchBreed(b.strain)) ?? (await this.matchBreed(breedText));
      if (!match) continue;
      await this.prisma.batch.update({
        where: { id: b.id },
        data: { breedId: match.breed.id, breedVariety: match.variety },
      });
      linked++;
    }
    if (linked) this.logger.log(`Linked ${linked} existing batch(es) to a breed guide`);
  }

  // ── Breed matching ──────────────────────────────────────────────────────

  /** Finds the breed whose alias appears in the text (longest alias wins).
   *  "Hyline Brown Max" → Hy-Line Brown, variety "Brown Max". */
  async matchBreed(text: string | null | undefined) {
    const norm = normaliseBreedText(text);
    if (!norm) return null;
    const breeds = await this.prisma.breed.findMany({ where: { isActive: true } });
    let best: { breed: (typeof breeds)[number]; alias: string } | null = null;
    for (const breed of breeds) {
      for (const alias of [...breed.aliases, normaliseBreedText(breed.name)]) {
        const a = normaliseBreedText(alias);
        if (a && norm.includes(a) && (!best || a.length > best.alias.length)) best = { breed, alias: a };
      }
    }
    if (!best) return null;
    return { breed: best.breed, variety: this.varietyFrom(String(text), best.breed.name) };
  }

  /** Words of the strain text beyond the breed's brand: "Hyline Brown Max"
   *  → "Brown Max". Plain "Hy-Line Brown" (the breed itself) → null. */
  private varietyFrom(text: string, breedName: string): string | null {
    const brand = normaliseBreedText(breedName.split(/\s+/)[0]);
    const words = text.trim().split(/[\s-]+/).filter(Boolean);
    let joined = '';
    let cut = -1;
    for (let i = 0; i < words.length; i++) {
      joined += normaliseBreedText(words[i]);
      if (joined.endsWith(brand)) { cut = i; break; }
    }
    const rest = (cut >= 0 ? words.slice(cut + 1) : []).join(' ').trim();
    if (!rest) return null;
    const breedRest = normaliseBreedText(breedName.split(/\s+/).slice(1).join(''));
    if (normaliseBreedText(rest) === breedRest) return null;
    return rest.replace(/\b\w/g, c => c.toUpperCase());
  }

  // ── Guides ──────────────────────────────────────────────────────────────

  /** Active guide for a breed: a variety-specific edition wins over the
   *  breed-wide one (all varieties share the breed-wide guide by default). */
  async activeGuide(breedId: string, variety?: string | null) {
    const guides = await this.prisma.breedGuide.findMany({
      where: { breedId, status: 'ACTIVE' },
      orderBy: [{ versionYear: 'desc' }, { activatedAt: 'desc' }],
    });
    const v = normaliseBreedText(variety);
    return (v && guides.find(g => g.variety && normaliseBreedText(g.variety) === v))
      ?? guides.find(g => !g.variety)
      ?? null;
  }

  async guidePoints(guideId: string): Promise<StandardPoint[]> {
    const cached = this.pointCache.get(guideId);
    if (cached) return cached;
    const rows = await this.prisma.breedStandardPoint.findMany({
      where: { guideId },
      orderBy: [{ metric: 'asc' }, { ageFrom: 'asc' }, { seq: 'asc' }],
    });
    const points = rows.map(r => ({
      metric: r.metric, variant: r.variant, ageUnit: r.ageUnit, ageFrom: r.ageFrom, ageTo: r.ageTo,
      min: num(r.minValue), target: num(r.targetValue), max: num(r.maxValue),
      unit: r.unit, label: r.label, phase: r.phase, text: r.textValue,
    }));
    const guide = await this.prisma.breedGuide.findUnique({ where: { id: guideId }, select: { status: true } });
    if (guide && guide.status !== 'DRAFT') this.pointCache.set(guideId, points);
    return points;
  }

  async listBreeds() {
    const breeds = await this.prisma.breed.findMany({
      orderBy: { name: 'asc' },
      include: {
        guides: {
          orderBy: [{ versionYear: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true, title: true, versionLabel: true, versionYear: true, variety: true, status: true,
            sourceKind: true, publisher: true, housingSystem: true, activatedAt: true, supersededAt: true, createdAt: true,
            _count: { select: { points: true } },
          },
        },
        _count: { select: { batches: true } },
      },
    });
    return breeds;
  }

  async getGuide(guideId: string) {
    const guide = await this.prisma.breedGuide.findUnique({
      where: { id: guideId },
      include: { breed: { select: { id: true, name: true, code: true } } },
    });
    if (!guide) throw new NotFoundException('Guide not found');
    const points = await this.guidePoints(guideId);
    const metrics = [...new Set(points.map(p => p.metric))].map(key => {
      const def = metricDef(key);
      return {
        key, label: def?.label ?? key, unit: def?.unit ?? '', group: def?.group ?? 'OTHER',
        capture: def?.capture ?? 'REFERENCE', points: points.filter(p => p.metric === key),
      };
    });
    return { ...guide, metrics };
  }

  /** Director makes a guide edition the benchmark. The previous active
   *  edition for the same breed/variety is archived (kept, marked superseded). */
  async activateGuide(guideId: string, userId: string) {
    const guide = await this.prisma.breedGuide.findUnique({ where: { id: guideId }, include: { breed: true } });
    if (!guide) throw new NotFoundException('Guide not found');
    if (guide.status === 'ACTIVE') return guide;
    const count = await this.prisma.breedStandardPoint.count({ where: { guideId } });
    if (count === 0) throw new BadRequestException('This guide has no data points — nothing to benchmark against.');

    const previous = await this.prisma.breedGuide.findMany({
      where: { breedId: guide.breedId, variety: guide.variety, status: 'ACTIVE' },
      select: { id: true, versionLabel: true },
    });
    const now = new Date();
    const activated = await this.prisma.$transaction(async tx => {
      if (previous.length) {
        await tx.breedGuide.updateMany({
          where: { id: { in: previous.map(p => p.id) } },
          data: { status: 'ARCHIVED', supersededById: guideId, supersededAt: now },
        });
      }
      return tx.breedGuide.update({
        where: { id: guideId },
        data: { status: 'ACTIVE', activatedById: userId, activatedAt: now, supersededById: null, supersededAt: null },
      });
    });
    this.pointCache.delete(guideId);

    const superseded = previous.length ? ` It replaces the ${previous.map(p => p.versionLabel).join(', ')} edition.` : '';
    for (const role of [UserRole.OWNER, UserRole.MANAGER]) {
      await this.notifications.notifyRole(
        role, NotificationType.BREED_GUIDE_ACTIVATED,
        `${guide.breed.name} guide: ${guide.versionLabel} edition now in use`,
        `All ${guide.breed.name}${guide.variety ? ` ${guide.variety}` : ''} batches are now benchmarked against "${guide.title}" (${guide.versionLabel}).${superseded}`,
        { entityId: guideId, entityType: 'BreedGuide', dedupeKey: `guide-activated:${guideId}` },
      ).catch(() => {});
    }
    return activated;
  }

  async archiveGuide(guideId: string) {
    const guide = await this.prisma.breedGuide.findUnique({ where: { id: guideId } });
    if (!guide) throw new NotFoundException('Guide not found');
    return this.prisma.breedGuide.update({ where: { id: guideId }, data: { status: 'ARCHIVED' } });
  }

  async createBreed(input: { name: string; code?: string; birdType?: string; aliases?: string[] }) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new BadRequestException('Breed name is required');
    const code = (input.code?.trim() || name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const aliases = [...new Set([normaliseBreedText(name), ...(input.aliases ?? []).map(normaliseBreedText)].filter(Boolean))];
    return this.prisma.breed.upsert({
      where: { code },
      create: { code, name, birdType: (input.birdType as BirdType) ?? BirdType.LAYER_COMMERCIAL, aliases },
      update: { aliases },
    });
  }

  async updateBreedAliases(breedId: string, aliases: string[]) {
    const breed = await this.prisma.breed.findUnique({ where: { id: breedId } });
    if (!breed) throw new NotFoundException('Breed not found');
    const clean = [...new Set(aliases.map(normaliseBreedText).filter(a => a.length >= 3))];
    const updated = await this.prisma.breed.update({ where: { id: breedId }, data: { aliases: clean } });
    await this.backfillBatchBreeds();
    return updated;
  }

  // ── Batch context ───────────────────────────────────────────────────────

  async batchContext(batchId: string): Promise<BatchStandardContext | null> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, deletedAt: null },
      include: { breed: { select: { id: true, name: true } } },
    });
    if (!batch) return null;
    const guide = batch.breedId ? await this.activeGuide(batch.breedId, batch.breedVariety) : null;
    return {
      batchId: batch.id,
      batchCode: batch.batchCode,
      breedId: batch.breedId,
      breedName: batch.breed?.name ?? null,
      variety: batch.breedVariety,
      guide: guide ? { id: guide.id, title: guide.title, versionLabel: guide.versionLabel, versionYear: guide.versionYear, variety: guide.variety } : null,
      dateOfHatch: batch.dateOfHatch,
      dateReceived: batch.dateReceived,
      housingType: batch.housingType ?? 'LIGHT_CONTROLLED',
      nutritionProgram: batch.nutritionProgram ?? 'BOTH',
      untracked: new Set([
        ...batch.untrackedMetrics,
        ...noInputMetrics().map(m => m.key),
        ...(batch.declaredLightHours == null ? ['LIGHT_HOURS'] : []),
      ]),
    };
  }

  // ── Band resolution ─────────────────────────────────────────────────────

  /**
   * Standard for one parameter at one age. Inside the guide's range a gap
   * (e.g. egg quality given every 2nd week) takes the latest row before it;
   * past the last row the metric's extrapolation rule decides (HOLD_LAST →
   * last row, basis GUIDE_EXTENDED; NONE → no standard).
   */
  async resolveBand(
    ctx: Pick<BatchStandardContext, 'breedId' | 'guide'>,
    metric: string,
    age: number,
    opts: { ageUnit?: AgeUnit; variant?: string | null } = {},
  ): Promise<ResolvedBand | null> {
    if (!ctx.guide || !ctx.breedId) return null;
    const ageUnit = opts.ageUnit ?? 'WEEK';
    const def = metricDef(metric);
    const points = (await this.guidePoints(ctx.guide.id))
      .filter(p => p.metric === metric && p.ageUnit === ageUnit && (opts.variant === undefined || p.variant === opts.variant));
    const hit = pickPoint(points, age, def?.extrapolation ?? 'NONE');
    if (!hit) return null;

    const guideBand = applyTolerance(hit.point, def);
    let band: ResolvedBand = {
      metric,
      ...guideBand,
      unit: hit.point.unit, label: hit.point.label, phase: hit.point.phase, text: hit.point.text,
      basis: hit.extended ? 'GUIDE_EXTENDED' : 'GUIDE',
      guideId: ctx.guide.id,
      farmStandardId: null,
      guide: guideBand,
    };

    const farm = await this.prisma.farmStandard.findFirst({
      where: { breedId: ctx.breedId, metric, status: 'APPROVED', ageUnit, ...(opts.variant ? { variant: opts.variant } : {}) },
      orderBy: { approvedAt: 'desc' },
    });
    if (farm) {
      const farmPoints = (farm.points as any[]).map(fp => ({
        metric, variant: farm.variant, ageUnit, ageFrom: Number(fp.ageFrom), ageTo: Number(fp.ageTo ?? fp.ageFrom),
        min: num(fp.min), target: num(fp.target), max: num(fp.max), unit: null, label: null, phase: null, text: null,
      }));
      const fHit = pickPoint(farmPoints, age, def?.extrapolation ?? 'NONE');
      if (fHit) {
        band = {
          ...band,
          min: fHit.point.min ?? band.min,
          target: fHit.point.target ?? band.target,
          max: fHit.point.max ?? band.max,
          basis: 'FARM',
          farmStandardId: farm.id,
        };
      }
    }
    return band;
  }

  /** Every row of a metric (for charts / reference tables). */
  async metricSeries(guideId: string, metric: string, variant?: string | null) {
    return (await this.guidePoints(guideId))
      .filter(p => p.metric === metric && (variant === undefined || p.variant === variant));
  }

  // ── Recording plan ──────────────────────────────────────────────────────

  /** What the guide covers, what the farm will record, and what it gives up. */
  async recordingPlan(ctx: BatchStandardContext) {
    const covered = ctx.guide ? new Set((await this.guidePoints(ctx.guide.id)).map(p => p.metric)) : new Set<string>();
    const describe = (m: MetricDefinition) => ({ key: m.key, label: m.label, unit: m.unit, group: m.group, capture: m.capture });
    const recordable = recordableMetrics().filter(m => covered.has(m.key));
    const recorded = recordable.filter(m => !ctx.untracked.has(m.key)).map(describe);
    const notRecorded = [
      ...recordable.filter(m => ctx.untracked.has(m.key)).map(m => ({
        ...describe(m),
        reason: m.capture === 'DECLARED' ? 'NOT_DECLARED' : 'FARM_CHOICE',
        implication: m.ifNotRecorded,
      })),
      ...noInputMetrics().filter(m => covered.has(m.key)).map(m => ({ ...describe(m), reason: 'NO_INPUT', implication: m.ifNotRecorded })),
    ];
    return { recorded, notRecorded };
  }

  /** Options for the batch registration form, for the breed typed so far. */
  async registrationOptions(strain: string) {
    const match = await this.matchBreed(strain);
    const guide = match ? await this.activeGuide(match.breed.id, match.variety) : null;
    const covered = guide ? new Set((await this.guidePoints(guide.id)).map(p => p.metric)) : null;
    const inGuide = (m: MetricDefinition) => !covered || covered.has(m.key);
    return {
      breed: match ? { id: match.breed.id, name: match.breed.name, variety: match.variety } : null,
      guide: guide ? { id: guide.id, title: guide.title, versionLabel: guide.versionLabel, versionYear: guide.versionYear, variety: guide.variety } : null,
      recordable: recordableMetrics().filter(inGuide).map(m => ({
        key: m.key, label: m.label, unit: m.unit, group: m.group, capture: m.capture,
        defaultOn: m.capture === 'SYSTEM', implication: m.ifNotRecorded,
      })),
      notRecordable: noInputMetrics().filter(inGuide).map(m => ({ key: m.key, label: m.label, implication: m.ifNotRecorded })),
      housingTypes: HOUSING_TYPES,
      nutritionPrograms: NUTRITION_PROGRAMS,
    };
  }

  /** Applies breed + recording plan fields from a registration/edit payload. */
  async applyBatchSetup(batchId: string, input: any, opts: { reresolveBreed?: boolean } = {}) {
    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Batch not found');
    const data: any = {};

    if (input.breedId !== undefined) {
      data.breedId = input.breedId || null;
    } else if (opts.reresolveBreed || !batch.breedId) {
      const match = await this.matchBreed(batch.strain);
      if (match) { data.breedId = match.breed.id; data.breedVariety = match.variety; }
    }
    if (input.breedVariety !== undefined) data.breedVariety = input.breedVariety || null;

    if (Array.isArray(input.untrackedMetrics)) {
      const allowed = new Set(recordableMetrics().map(m => m.key));
      data.untrackedMetrics = [...new Set(input.untrackedMetrics.map(String))].filter(k => allowed.has(k as string));
      data.recordingPlanSetAt = new Date();
    } else if (Array.isArray(input.recordedMetrics)) {
      const recorded = new Set(input.recordedMetrics.map(String));
      data.untrackedMetrics = recordableMetrics().map(m => m.key).filter(k => !recorded.has(k));
      data.recordingPlanSetAt = new Date();
    }
    if (input.housingType !== undefined) {
      if (input.housingType && !HOUSING_TYPES.includes(input.housingType)) throw new BadRequestException('housingType must be LIGHT_CONTROLLED or OPEN_SIDED');
      data.housingType = input.housingType || null;
    }
    if (input.housingDescription !== undefined) data.housingDescription = input.housingDescription ? String(input.housingDescription).slice(0, 1000) : null;
    if (input.declaredLightHours !== undefined) {
      const h = input.declaredLightHours === null || input.declaredLightHours === '' ? null : Number(input.declaredLightHours);
      if (h != null && (!Number.isFinite(h) || h < 0 || h > 24)) throw new BadRequestException('Light hours must be between 0 and 24');
      data.declaredLightHours = h;
    }
    if (input.nutritionProgram !== undefined) {
      if (!NUTRITION_PROGRAMS.includes(input.nutritionProgram)) throw new BadRequestException('nutritionProgram must be ECONOMICAL, OPTIMAL or BOTH');
      data.nutritionProgram = input.nutritionProgram;
    }
    if (Object.keys(data).length === 0) return batch;
    return this.prisma.batch.update({ where: { id: batchId }, data });
  }

  metricCatalog() {
    return METRICS;
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Row covering `age`; else the latest row before it (gap inside the guide);
 *  else, past the last row, that last row when extrapolation is HOLD_LAST. */
export function pickPoint(points: StandardPoint[], age: number, extrapolation: 'HOLD_LAST' | 'NONE') {
  if (points.length === 0) return null;
  const covering = points.filter(p => age >= p.ageFrom && age <= p.ageTo);
  if (covering.length) return { point: covering[covering.length - 1], extended: false };
  const lastTo = Math.max(...points.map(p => p.ageTo));
  const firstFrom = Math.min(...points.map(p => p.ageFrom));
  if (age < firstFrom) return null;
  const before = points.filter(p => p.ageTo < age).sort((a, b) => b.ageTo - a.ageTo)[0];
  if (!before) return null;
  if (age > lastTo) return extrapolation === 'HOLD_LAST' ? { point: before, extended: true } : null;
  return { point: before, extended: false };
}

/** Guide rows that give one value (egg weight, light hours) get a band
 *  around it from the catalogue's tolerance; directional metrics drop the
 *  side that is not a problem (more eggs is never "off standard"). */
export function applyTolerance(p: Pick<StandardPoint, 'min' | 'target' | 'max'>, def?: MetricDefinition) {
  let { min, max } = p;
  const target = p.target;
  if (min == null && max == null && target != null && def) {
    if (def.toleranceAbs != null) { min = target - def.toleranceAbs; max = target + def.toleranceAbs; }
    else if (def.tolerancePct != null) { min = target * (1 - def.tolerancePct / 100); max = target * (1 + def.tolerancePct / 100); }
    if (def.direction === 'HIGHER_BETTER') max = null;
    if (def.direction === 'LOWER_BETTER') min = null;
  }
  if (def?.direction === 'HIGHER_BETTER') max = null;
  if (def?.direction === 'LOWER_BETTER') min = null;
  const r = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  return { min: r(min), target: r(target), max: r(max) };
}

export function bandStatus(actual: number, band: { min: number | null; max: number | null }): 'IN_BAND' | 'BELOW' | 'ABOVE' {
  if (band.min != null && actual < band.min) return 'BELOW';
  if (band.max != null && actual > band.max) return 'ABOVE';
  return 'IN_BAND';
}
