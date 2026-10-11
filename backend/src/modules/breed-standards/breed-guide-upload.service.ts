// src/modules/breed-standards/breed-guide-upload.service.ts
//
// New breeds and new guide editions. A guide arrives either in the fixed
// template (CSV / Excel / JSON — read exactly) or as the publisher's PDF /
// a photo (read by Claude into the same template). Either way it is saved
// as a DRAFT edition; the Director checks it and activates it, which
// archives the edition it supersedes.
import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { METRICS } from './breed-metrics.catalog';
import { BreedStandardService, normaliseBreedText } from './breed-standard.service';
import { GuidePointInput } from './guides/hyline-brown-2024.guide';

export const TEMPLATE_HEADERS = ['metric', 'variant', 'age_unit', 'age_from', 'age_to', 'min', 'target', 'max', 'unit', 'label', 'phase', 'text'];

export interface GuideUploadInput {
  breedId?: string;
  breedName?: string;
  aliases?: string;
  title?: string;
  versionLabel?: string;
  versionYear?: string | number;
  variety?: string;
  publisher?: string;
  housingSystem?: string;
  notes?: string;
}

const numOrNull = (v: any) => {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

/** Rows (objects keyed by template header) → validated guide points. */
export function rowsToPoints(rows: Record<string, any>[]): { points: GuidePointInput[]; errors: string[] } {
  const points: GuidePointInput[] = [];
  const errors: string[] = [];
  rows.forEach((raw, i) => {
    const r: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim().toLowerCase().replace(/\s+/g, '_')] = typeof v === 'string' ? v.trim() : v;
    const metric = String(r.metric ?? '').toUpperCase().replace(/\s+/g, '_');
    if (!metric) return;
    const ageFrom = numOrNull(r.age_from);
    if (ageFrom == null) { errors.push(`Row ${i + 2}: age_from missing for ${metric}`); return; }
    const p: GuidePointInput = {
      metric,
      variant: r.variant ? String(r.variant).toUpperCase().replace(/\s+/g, '_') : null,
      ageUnit: String(r.age_unit ?? 'WEEK').toUpperCase() === 'DAY' ? 'DAY' : 'WEEK',
      ageFrom: Math.round(ageFrom),
      ageTo: Math.round(numOrNull(r.age_to) ?? ageFrom),
      min: numOrNull(r.min), target: numOrNull(r.target), max: numOrNull(r.max),
      unit: r.unit ? String(r.unit) : null, label: r.label ? String(r.label) : null,
      phase: r.phase ? String(r.phase) : null, text: r.text ? String(r.text) : null,
    };
    if (p.min == null && p.target == null && p.max == null && !p.text) { errors.push(`Row ${i + 2}: no value for ${metric}`); return; }
    if ((p.ageTo ?? p.ageFrom) < p.ageFrom) { errors.push(`Row ${i + 2}: age_to before age_from`); return; }
    points.push(p);
  });
  return { points, errors };
}

@Injectable()
export class BreedGuideUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standards: BreedStandardService,
    private readonly ai: AiService,
  ) {}

  templateCsv(): string {
    const example = [
      ['BODY_WEIGHT', '', 'WEEK', '1', '1', '70', '', '80', 'g', '', '', ''],
      ['HEN_DAY_PCT', '', 'WEEK', '25', '25', '94.2', '', '96.2', '%', '', '', ''],
      ['EGG_WEIGHT', '', 'WEEK', '25', '25', '', '58.4', '', 'g/egg', '', '', ''],
      ['LIGHT_HOURS', 'LIGHT_CONTROLLED', 'WEEK', '6', '15', '', '10', '', 'h', '', '', ''],
      ['BROODING_TEMP', 'CAGE', 'DAY', '0', '3', '33', '', '36', '°C', '', '', ''],
      ['FEED_PHASE', '', 'WEEK', '7', '12', '', '1150', '', 'g', 'Grower', 'Grower', 'GROWER_MASH'],
    ];
    const keys = METRICS.map(m => `# ${m.key} — ${m.label}${m.unit ? ` (${m.unit})` : ''}`).join('\n');
    return `${TEMPLATE_HEADERS.join(',')}\n${example.map(r => r.join(',')).join('\n')}\n# Metric keys:\n${keys}\n`;
  }

  async upload(file: Express.Multer.File, input: GuideUploadInput, userId: string) {
    if (!file) throw new BadRequestException('No file uploaded');
    const versionLabel = String(input.versionLabel ?? '').trim();
    const versionYear = Number(input.versionYear);
    if (!versionLabel) throw new BadRequestException('Give the guide edition (e.g. "January 2024") so it is clear which version is in use');
    if (!Number.isInteger(versionYear) || versionYear < 1990 || versionYear > 2100) throw new BadRequestException('Give the guide year (e.g. 2024)');

    // Breed: pick an existing one, or name a new one.
    let breedId = input.breedId;
    if (!breedId) {
      if (!input.breedName?.trim()) throw new BadRequestException('Choose the breed or type a new breed name');
      const match = await this.standards.matchBreed(input.breedName);
      breedId = match && normaliseBreedText(match.breed.name) === normaliseBreedText(input.breedName)
        ? match.breed.id
        : (await this.standards.createBreed({ name: input.breedName, aliases: String(input.aliases ?? '').split(',') })).id;
    }
    const variety = input.variety?.trim() || null;
    const clash = await this.prisma.breedGuide.findFirst({ where: { breedId, versionLabel, variety } });
    if (clash) throw new BadRequestException(`The ${versionLabel} edition${variety ? ` for ${variety}` : ''} is already on file (${clash.status.toLowerCase()}). Archive it first or use a different edition name.`);

    const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
    let rows: Record<string, any>[];
    let sourceKind = 'TEMPLATE';
    let aiInterpretation: string | null = null;
    if (['csv', 'xlsx', 'xls'].includes(ext)) {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, any>[];
    } else if (ext === 'json') {
      const parsed = JSON.parse(file.buffer.toString('utf8'));
      rows = Array.isArray(parsed) ? parsed : parsed.points ?? [];
    } else if (['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const mime = ext === 'pdf' ? 'application/pdf' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const read = await this.ai.extractBreedGuide(file.buffer, mime, METRICS.map(m => m.key), input.notes);
      if (!read || !read.csv) {
        throw new BadRequestException('The guide could not be read automatically (AI not configured or the file was unreadable). Download the template, fill it in and upload it as CSV/Excel.');
      }
      const wb = XLSX.read(read.csv.split('\n').filter(l => !l.startsWith('#')).join('\n'), { type: 'string' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, any>[];
      sourceKind = 'AI';
      aiInterpretation = read.interpretation;
    } else {
      throw new BadRequestException(`Unsupported file ".${ext}". Upload the template (CSV/Excel/JSON) or the guide itself (PDF/photo).`);
    }

    const { points, errors } = rowsToPoints(rows);
    if (points.length === 0) throw new BadRequestException(`No usable rows found.${errors.length ? ` ${errors.slice(0, 5).join('; ')}` : ''}`);

    const breed = await this.prisma.breed.findUniqueOrThrow({ where: { id: breedId } });
    const guide = await this.prisma.breedGuide.create({
      data: {
        breedId, versionLabel, versionYear, variety,
        title: input.title?.trim() || `${breed.name} performance guide`,
        publisher: input.publisher?.trim() || null, housingSystem: input.housingSystem?.trim() || null,
        sourceFileName: file.originalname, status: 'DRAFT', sourceKind, aiInterpretation,
        notes: input.notes?.trim() || null, uploadedById: userId,
      },
    });
    await this.standards.insertPoints(guide.id, points);
    const unknown = [...new Set(points.map(p => p.metric))].filter(k => !METRICS.some(m => m.key === k));
    return {
      guideId: guide.id, status: guide.status, points: points.length, sourceKind, aiInterpretation,
      warnings: [...errors.slice(0, 20), ...(unknown.length ? [`Kept as reference only (not a known parameter): ${unknown.join(', ')}`] : [])],
    };
  }
}
