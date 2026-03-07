import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HealthEventType, VaccinationRoute } from '@prisma/client';
import dayjs from 'dayjs';

@Injectable()
export class HealthService {
  constructor(private prisma: PrismaService) {}

  async logHealthEvent(dto: {
    batchId: string;
    eventType: HealthEventType;
    eventDate: string;
    affectedCount: number;
    symptoms?: string;
    diagnosis?: string;
    treatment?: string;
  }, recordedById: string) {
    return this.prisma.healthEvent.create({
      data: { ...dto, eventDate: new Date(dto.eventDate), recordedById },
    });
  }

  async logVaccination(dto: {
    batchId: string;
    scheduleId?: string;
    vaccineName: string;
    administeredDate: string;
    route: VaccinationRoute;
    batchSize: number;
    dosageUnits?: string;
    vetName?: string;
    notes?: string;
  }, recordedById: string) {
    return this.prisma.vaccinationRecord.create({
      data: { ...dto, administeredDate: new Date(dto.administeredDate), recordedById },
    });
  }

  async getVaccinationSchedule(birdType?: string) {
    return this.prisma.vaccinationSchedule.findMany({
      where: { isActive: true, ...(birdType && { birdType: birdType as any }) },
      orderBy: { ageWeeks: 'asc' },
    });
  }

  async getHealthEvents(batchId: string) {
    return this.prisma.healthEvent.findMany({
      where: { batchId },
      orderBy: { eventDate: 'desc' },
      include: { vetReports: { select: { id: true, reportDate: true, summary: true, vetName: true } } },
    });
  }

  async logVisitor(dto: {
    visitorName: string;
    organisation?: string;
    purpose: string;
    checkInAt: string;
    houseId?: string;
    biosecurityChecks: Record<string, boolean>;
  }, recordedById: string) {
    return this.prisma.visitorLog.create({
      data: {
        visitorName: dto.visitorName,
        organisation: dto.organisation,
        purpose: dto.purpose,
        checkInAt: new Date(dto.checkInAt),
        houseId: dto.houseId,
        biosecurityChecks: dto.biosecurityChecks,
        recordedById,
      },
    });
  }
}
