// src/modules/store/store-operations.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestUser } from '../../auth/types/request-user.type';
import dayjs from 'dayjs';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface LogMedicationDto {
  batchId: string;
  houseId: string;
  logDate: string;
  medicationName: string;
  dosage?: string;
  quantityUnits?: string;
  costKes: number;
  notes?: string;
}

export interface LogEquipmentDto {
  logDate: string;
  equipmentName: string;
  eventType: 'PURCHASE' | 'REPAIR' | 'MAINTENANCE';
  description?: string;
  costKes: number;
  vendorName?: string;
  notes?: string;
}

export interface LogVetVisitDto {
  visitDate: string;
  vetName: string;
  purpose: string;
  batchesSeen?: string[];
  findings?: string;
  costKes: number;
  notes?: string;
}

export interface LogWorkerAssignmentDto {
  weekStartDate: string;
  workerName: string;
  houseId: string;
  roleTitle?: string;
  salaryKes: number;
  notes?: string;
}

// ── SERVICE ───────────────────────────────────────────────────────────────────

@Injectable()
export class StoreOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Medication Logs ────────────────────────────────────────────────────────

  async logMedication(dto: LogMedicationDto, user: RequestUser) {
    return this.prisma.storeMedicationLog.create({
      data: {
        batchId: dto.batchId,
        houseId: dto.houseId,
        logDate: new Date(dto.logDate),
        medicationName: dto.medicationName,
        dosage: dto.dosage ?? null,
        quantityUnits: dto.quantityUnits ?? null,
        costKes: dto.costKes,
        notes: dto.notes ?? null,
        loggedById: user.id,
      },
    });
  }

  async getMedicationLogs(batchId?: string, from?: string, to?: string) {
    return this.prisma.storeMedicationLog.findMany({
      where: {
        ...(batchId ? { batchId } : {}),
        ...(from || to ? {
          logDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      include: {
        batch: { select: { batchCode: true } },
        loggedBy: { select: { fullName: true } },
      },
      orderBy: { logDate: 'desc' },
      take: 100,
    });
  }

  async deleteMedicationLog(id: string) {
    const record = await this.prisma.storeMedicationLog.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Medication log not found');
    return this.prisma.storeMedicationLog.delete({ where: { id } });
  }

  // ── Equipment Logs ─────────────────────────────────────────────────────────

  async logEquipment(dto: LogEquipmentDto, user: RequestUser) {
    return this.prisma.storeEquipmentLog.create({
      data: {
        logDate: new Date(dto.logDate),
        equipmentName: dto.equipmentName,
        eventType: dto.eventType,
        description: dto.description ?? null,
        costKes: dto.costKes,
        vendorName: dto.vendorName ?? null,
        notes: dto.notes ?? null,
        loggedById: user.id,
      },
    });
  }

  async getEquipmentLogs(from?: string, to?: string) {
    return this.prisma.storeEquipmentLog.findMany({
      where: {
        ...(from || to ? {
          logDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      include: {
        loggedBy: { select: { fullName: true } },
      },
      orderBy: { logDate: 'desc' },
      take: 100,
    });
  }

  async deleteEquipmentLog(id: string) {
    const record = await this.prisma.storeEquipmentLog.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Equipment log not found');
    return this.prisma.storeEquipmentLog.delete({ where: { id } });
  }

  // ── Vet Visit Logs ─────────────────────────────────────────────────────────

  async logVetVisit(dto: LogVetVisitDto, user: RequestUser) {
    return (this.prisma as any).storeVetVisitLog.create({
      data: {
        visitDate: new Date(dto.visitDate),
        vetName: dto.vetName,
        purpose: dto.purpose,
        batchesSeen: dto.batchesSeen ?? [],
        findings: dto.findings ?? null,
        costKes: dto.costKes,
        notes: dto.notes ?? null,
        loggedById: user.id,
      },
    });
  }

  async getVetVisitLogs(from?: string, to?: string) {
    return (this.prisma as any).storeVetVisitLog.findMany({
      where: {
        ...(from || to ? {
          visitDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      include: {
        loggedBy: { select: { fullName: true } },
      },
      orderBy: { visitDate: 'desc' },
      take: 100,
    });
  }

  async deleteVetVisitLog(id: string) {
    const record = await (this.prisma as any).storeVetVisitLog.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Vet visit log not found');
    return (this.prisma as any).storeVetVisitLog.delete({ where: { id } });
  }

  // ── Worker Assignments ─────────────────────────────────────────────────────

  async logWorkerAssignment(dto: LogWorkerAssignmentDto, user: RequestUser) {
    return this.prisma.storeWorkerAssignment.create({
      data: {
        weekStartDate: new Date(dto.weekStartDate),
        workerName: dto.workerName,
        houseId: dto.houseId,
        roleTitle: dto.roleTitle ?? null,
        salaryKes: dto.salaryKes,
        notes: dto.notes ?? null,
        loggedById: user.id,
      },
    });
  }

  async getWorkerAssignments(weekStartDate?: string, houseId?: string) {
    return this.prisma.storeWorkerAssignment.findMany({
      where: {
        ...(weekStartDate ? { weekStartDate: new Date(weekStartDate) } : {}),
        ...(houseId ? { houseId } : {}),
      },
      include: {
        house: { select: { name: true, code: true } },
        loggedBy: { select: { fullName: true } },
      },
      orderBy: [{ weekStartDate: 'desc' }, { workerName: 'asc' }],
      take: 200,
    });
  }

  async deleteWorkerAssignment(id: string) {
    const record = await this.prisma.storeWorkerAssignment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Worker assignment not found');
    return this.prisma.storeWorkerAssignment.delete({ where: { id } });
  }

  // ── Operations Summary (for Accountant/Director cost visibility) ───────────

  async getOperationsCostSummary(from: string, to: string) {
    const dateFilter = {
      gte: new Date(from),
      lte: new Date(to),
    };

    const [medicationCosts, equipmentCosts, vetCosts, workerCosts] = await Promise.all([
      this.prisma.storeMedicationLog.aggregate({
        where: { logDate: dateFilter },
        _sum: { costKes: true },
        _count: true,
      }),
      this.prisma.storeEquipmentLog.aggregate({
        where: { logDate: dateFilter },
        _sum: { costKes: true },
        _count: true,
      }),
      (this.prisma as any).storeVetVisitLog.aggregate({
        where: { visitDate: dateFilter },
        _sum: { costKes: true },
        _count: true,
      }),
      this.prisma.storeWorkerAssignment.aggregate({
        where: { weekStartDate: { gte: new Date(from), lte: new Date(to) } },
        _sum: { salaryKes: true },
        _count: true,
      }),
    ]);

    return {
      period: { from, to },
      medication: {
        totalKes: Number(medicationCosts._sum.costKes ?? 0),
        count: medicationCosts._count,
      },
      equipment: {
        totalKes: Number(equipmentCosts._sum.costKes ?? 0),
        count: equipmentCosts._count,
      },
      vetVisits: {
        totalKes: Number(vetCosts._sum.costKes ?? 0),
        count: vetCosts._count,
      },
      labour: {
        totalKes: Number(workerCosts._sum.salaryKes ?? 0),
        count: workerCosts._count,
      },
      grandTotalKes:
        Number(medicationCosts._sum.costKes ?? 0) +
        Number(equipmentCosts._sum.costKes ?? 0) +
        Number(vetCosts._sum.costKes ?? 0) +
        Number(workerCosts._sum.salaryKes ?? 0),
    };
  }
}
