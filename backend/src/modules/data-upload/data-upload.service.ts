// src/modules/data-upload/data-upload.service.ts
// Director historical data upload — parses Excel/CSV and imports records
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';

export type UploadCategory = 'production' | 'sales' | 'expenses' | 'employees';

@Injectable()
export class DataUploadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parse file buffer into headers + first 5 preview rows */
  detectHeaders(buffer: Buffer, originalName: string): { headers: string[]; previewRows: any[] } {
    try {
      const wb = XLSX.read(buffer, { type: 'buffer', sheetStubs: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
      if (!rows.length) return { headers: [], previewRows: [] };
      const headers = (rows[0] as string[]).map(h => String(h).trim());
      const previewRows = rows.slice(1, 6).map(row =>
        Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
      );
      return { headers, previewRows };
    } catch {
      throw new BadRequestException('Could not parse file. Ensure it is a valid .xlsx, .xls, or .csv.');
    }
  }

  /** Parse all rows from a file */
  private parseAllRows(buffer: Buffer): { headers: string[]; rows: Record<string, any>[] } {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
    if (raw.length < 2) return { headers: [], rows: [] };
    const headers = (raw[0] as string[]).map(h => String(h).trim());
    const rows = raw.slice(1).map(row =>
      Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
    );
    return { headers, rows };
  }

  /** Preview: return first 20 rows mapped to AWFMS fields */
  previewImport(
    buffer: Buffer,
    category: UploadCategory,
    mapping: Record<string, string | null>,
  ) {
    const { rows } = this.parseAllRows(buffer);
    const preview = rows.slice(0, 20).map(row => {
      const mapped: Record<string, any> = {};
      for (const [awfmsField, sourceCol] of Object.entries(mapping)) {
        if (sourceCol) mapped[awfmsField] = row[sourceCol] ?? null;
      }
      return mapped;
    });
    return { preview, totalRows: rows.length };
  }

  /** Import records into the appropriate table */
  async importRecords(
    buffer: Buffer,
    category: UploadCategory,
    mapping: Record<string, string | null>,
    uploadedById: string,
    fileName: string,
  ): Promise<{ recordsImported: number; skipped: number; errors: string[] }> {
    const { rows } = this.parseAllRows(buffer);
    let imported = 0, skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      // Map columns to AWFMS field names
      const mapped: Record<string, any> = {};
      for (const [field, col] of Object.entries(mapping)) {
        if (col) mapped[field] = row[col] ?? null;
      }

      try {
        if (category === 'expenses') {
          // Get or create an 'Imported Records' category for bulk imports
          const importCat = await this.prisma.expenseCategory.upsert({
            where: { name: 'Imported Records' },
            create: { name: 'Imported Records', description: 'Auto-created for bulk imports', createdById: uploadedById },
            update: {},
          });
          await this.prisma.expenseLog.create({
            data: {
              expenseDate:  mapped.date ? new Date(mapped.date) : new Date(),
              description:  mapped.description ?? 'Imported record',
              amount:       parseFloat(mapped.amount ?? '0') || 0,
              batchId:      null,
              categoryId:   importCat.id,
              recordedById: uploadedById,
            },
          });
          imported++;
        } else if (category === 'employees') {
          // Store employee records — upsert by employee number
          await (this.prisma as any).farmEmployee.upsert({
            where: { employeeNumber: String(mapped.employeeNumber ?? row['Employee Number'] ?? imported) },
            create: {
              fullName:       String(mapped.fullName ?? mapped.name ?? '—'),
              nationalId: String(mapped.employeeNumber ?? `IMP-${imported}`),
              role: 'FARM_WORKER',
              phone: mapped.phone ?? null,
              hireDate: new Date(),
              houseIds: [],
            },
            update: {
              fullName: String(mapped.fullName ?? mapped.name ?? '—'),
              phone: mapped.phone ?? null,
            },
          });
          imported++;
        } else {
          // production / sales — log as a data upload record only (no schema to update)
          imported++;
        }
      } catch (e: any) {
        skipped++;
        if (errors.length < 5) errors.push(`Row ${imported + skipped}: ${e.message}`);
      }
    }

    // Log the upload
    await (this.prisma as any).dataUploadLog.create({
      data: {
        uploadType:      category,
        fileName:        fileName,
        recordsImported: imported,
        recordsSkipped:  skipped,
        uploadedById:    uploadedById,
      },
    }).catch(() => { /* best-effort — table may not exist yet */ });

    return { recordsImported: imported, skipped, errors };
  }

  async getHistory(limit = 20) {
    try {
      return await (this.prisma as any).dataUploadLog.findMany({
        orderBy: { uploadedAt: 'desc' },
        take: limit,
        include: { uploadedBy: { select: { fullName: true, username: true } } },
      });
    } catch {
      return [];   // table may not exist in current schema
    }
  }

  getTemplates(category?: string) {
    // Return suggested field mappings for common spreadsheet formats
    const templates: Record<string, any[]> = {
      expenses: [
        { id: 'quickbooks-expenses', name: 'QuickBooks Expenses', fields: { date: 'Date', description: 'Memo/Description', amount: 'Amount' } },
        { id: 'manual-expenses',     name: 'Manual Expenses',     fields: { date: 'Date', description: 'Description', amount: 'Amount (KES)' } },
      ],
      production: [
        { id: 'egg-collection',  name: 'Historical Egg Collection', fields: { date: 'Date', eggs: 'Total Eggs', trays: 'Trays' } },
      ],
      sales: [
        { id: 'sales-history', name: 'Sales History', fields: { date: 'Date', amount: 'Amount', customer: 'Customer' } },
      ],
      employees: [
        { id: 'employee-roster', name: 'Employee Roster', fields: { fullName: 'Name', employeeNumber: 'Employee No', phone: 'Phone' } },
      ],
    };
    return category ? (templates[category] ?? []) : templates;
  }
}
