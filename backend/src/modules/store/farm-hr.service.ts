// src/modules/store/farm-hr.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmployeeStatus } from '@prisma/client';

const VALID_EMPLOYEE_STATUSES = Object.values(EmployeeStatus) as string[];

// FIX: `status` used to go straight from the query string / request body
// into Prisma with an `as any` cast — any value that isn't a real
// EmployeeStatus (e.g. the frontend's old "INACTIVE", which was never a
// real enum member; the real one is "ON_LEAVE") reached the DB layer and
// crashed with an unhandled PrismaClientValidationError (500) instead of a
// clean, actionable 400.
function assertValidEmployeeStatus(status: string): void {
  if (!VALID_EMPLOYEE_STATUSES.includes(status)) {
    throw new BadRequestException(
      `Invalid employee status "${status}". Must be one of: ${VALID_EMPLOYEE_STATUSES.join(', ')}.`,
    );
  }
}

export interface CreateEmployeeDto {
  fullName: string;
  employeeNumber?: string;   // ← added
  nationalId?: string;
  address?: string;          // ← added
  workPhone?: string;        // ← added
  mobilePhone?: string;      // ← added
  phone?: string;            // legacy – kept for backwards compat
  email?: string;
  role: string;
  assignment?: string;
  houseIds?: string[];
  salaryKes?: number;
  payPeriod?: 'WEEKLY' | 'MONTHLY';
  hireDate: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelation?: string;
  notes?: string;
}

export interface UpdateEmployeeDto {
  fullName?: string;
  employeeNumber?: string;
  nationalId?: string;
  address?: string;
  workPhone?: string;
  mobilePhone?: string;
  phone?: string;            // legacy
  email?: string;
  role?: string;
  assignment?: string;
  houseIds?: string[];
  salaryKes?: number;
  payPeriod?: string;
  hireDate?: string;         // ← added: allow editing hire date
  status?: string;
  terminatedDate?: string;
  terminationReason?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelation?: string;
  notes?: string;
}

export interface CreateConstructionDto {
  title: string;
  constructionType: string;
  location: string;
  startDate: string;
  endDate?: string;
  contractorName?: string;
  contractorPhone?: string;
  budgetKes?: number;
  actualCostKes?: number;
  status?: string;
  description?: string;
  notes?: string;
}

export interface UpdateConstructionDto {
  title?: string;
  constructionType?: string;
  location?: string;
  endDate?: string;
  contractorName?: string;
  contractorPhone?: string;
  budgetKes?: number;
  actualCostKes?: number;
  status?: string;
  description?: string;
  notes?: string;
}


/**
 * Parse a date string safely.
 * Returns a Date only when the value is a fully-valid YYYY-MM-DD string
 * with a 4-digit year >= 1900. Returns undefined for empty strings, null,
 * partial values, or "0026-..." accidents that browsers emit while the
 * user is still typing a year digit-by-digit.
 */
function safeDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const year = parseInt(value.slice(0, 4), 10);
  if (year < 1900) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

@Injectable()
export class FarmHRService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(status?: string) {
    if (status) assertValidEmployeeStatus(status);
    return this.prisma.farmEmployee.findMany({
      where: status ? { status: status as any } : {},
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    });
  }

  async getEmployeeById(id: string) {
    const emp = await this.prisma.farmEmployee.findUnique({ where: { id } });
    if (!emp) throw new NotFoundException('Employee not found');
    return emp;
  }

  async createEmployee(dto: CreateEmployeeDto) {
    return this.prisma.farmEmployee.create({
      data: {
        fullName:          dto.fullName,
        employeeNumber:    dto.employeeNumber    ?? null,   // ← added
        nationalId:        dto.nationalId        ?? null,
        address:           dto.address           ?? null,   // ← added
        workPhone:         dto.workPhone         ?? null,   // ← added
        mobilePhone:       dto.mobilePhone       ?? null,   // ← added
        phone:             dto.phone             ?? null,
        email:             dto.email             ?? null,
        role:              dto.role,
        assignment:        dto.assignment        ?? null,
        houseIds:          dto.houseIds          ?? [],
        salaryKes:         dto.salaryKes         ?? 0,
        payPeriod:         dto.payPeriod         ?? 'MONTHLY',
        hireDate:          safeDate(dto.hireDate) ?? new Date(dto.hireDate),
        nextOfKinName:     dto.nextOfKinName     ?? null,
        nextOfKinPhone:    dto.nextOfKinPhone    ?? null,
        nextOfKinRelation: dto.nextOfKinRelation ?? null,
        notes:             dto.notes             ?? null,
      },
    });
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    if (dto.status !== undefined) assertValidEmployeeStatus(dto.status);
    const existing = await this.getEmployeeById(id);

    // A record can't end up TERMINATED with no reason on file — required
    // either on this same request or already saved from an earlier one
    // (e.g. re-editing other fields on an already-terminated employee).
    if (dto.status === 'TERMINATED') {
      const reason = dto.terminationReason?.trim() ?? existing.terminationReason?.trim();
      if (!reason) {
        throw new BadRequestException('A reason for termination is required when setting an employee\'s status to Terminated.');
      }
    }

    return this.prisma.farmEmployee.update({
      where: { id },
      data: {
        ...(dto.fullName          !== undefined ? { fullName:          dto.fullName }                          : {}),
        ...(dto.employeeNumber    !== undefined ? { employeeNumber:    dto.employeeNumber }                    : {}),  // ← added
        ...(dto.nationalId        !== undefined ? { nationalId:        dto.nationalId }                        : {}),
        ...(dto.address           !== undefined ? { address:           dto.address }                           : {}),  // ← added
        ...(dto.workPhone         !== undefined ? { workPhone:         dto.workPhone }                         : {}),  // ← added
        ...(dto.mobilePhone       !== undefined ? { mobilePhone:       dto.mobilePhone }                       : {}),  // ← added
        ...(dto.phone             !== undefined ? { phone:             dto.phone }                             : {}),
        ...(dto.email             !== undefined ? { email:             dto.email }                             : {}),
        ...(dto.role              !== undefined ? { role:              dto.role }                              : {}),
        ...(dto.assignment        !== undefined ? { assignment:        dto.assignment }                        : {}),
        ...(dto.houseIds          !== undefined ? { houseIds:          dto.houseIds }                          : {}),
        ...(dto.salaryKes         !== undefined ? { salaryKes:         dto.salaryKes }                         : {}),
        ...(dto.payPeriod         !== undefined ? { payPeriod:         dto.payPeriod }                         : {}),
        ...(dto.hireDate          !== undefined && safeDate(dto.hireDate) !== undefined
            ? { hireDate: safeDate(dto.hireDate)! } : {}),
        ...(dto.status            !== undefined ? { status:            dto.status as any }                     : {}),
        ...(dto.terminatedDate    !== undefined && safeDate(dto.terminatedDate) !== undefined
            ? { terminatedDate: safeDate(dto.terminatedDate)! } : {}),
        ...(dto.terminationReason !== undefined ? { terminationReason: dto.terminationReason }                 : {}),
        ...(dto.nextOfKinName     !== undefined ? { nextOfKinName:     dto.nextOfKinName }                     : {}),
        ...(dto.nextOfKinPhone    !== undefined ? { nextOfKinPhone:    dto.nextOfKinPhone }                    : {}),
        ...(dto.nextOfKinRelation !== undefined ? { nextOfKinRelation: dto.nextOfKinRelation }                 : {}),
        ...(dto.notes             !== undefined ? { notes:             dto.notes }                             : {}),
      },
    });
  }

  async listConstruction(status?: string) {
    return this.prisma.constructionRecord.findMany({
      where: status ? { status } : {},
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
  }

  async getConstructionById(id: string) {
    const rec = await this.prisma.constructionRecord.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Construction record not found');
    return rec;
  }

  async createConstruction(dto: CreateConstructionDto) {
    return this.prisma.constructionRecord.create({
      data: {
        title:            dto.title,
        constructionType: dto.constructionType as any,
        location:         dto.location,
        startDate:        safeDate(dto.startDate) ?? new Date(dto.startDate),
        endDate:          safeDate(dto.endDate) ?? null,
        contractorName:   dto.contractorName  ?? null,
        contractorPhone:  dto.contractorPhone ?? null,
        budgetKes:        dto.budgetKes       ?? 0,
        actualCostKes:    dto.actualCostKes   ?? 0,
        status:           dto.status          ?? 'IN_PROGRESS',
        description:      dto.description     ?? null,
        notes:            dto.notes           ?? null,
      },
    });
  }

  async updateConstruction(id: string, dto: UpdateConstructionDto) {
    await this.getConstructionById(id);
    return this.prisma.constructionRecord.update({
      where: { id },
      data: {
        ...(dto.title            !== undefined ? { title:            dto.title }                                      : {}),
        ...(dto.constructionType !== undefined ? { constructionType: dto.constructionType as any }                    : {}),
        ...(dto.location         !== undefined ? { location:         dto.location }                                   : {}),
        ...(dto.endDate          !== undefined ? { endDate: safeDate(dto.endDate) ?? null }                          : {}),
        ...(dto.contractorName   !== undefined ? { contractorName:   dto.contractorName }                             : {}),
        ...(dto.contractorPhone  !== undefined ? { contractorPhone:  dto.contractorPhone }                            : {}),
        ...(dto.budgetKes        !== undefined ? { budgetKes:        dto.budgetKes }                                  : {}),
        ...(dto.actualCostKes    !== undefined ? { actualCostKes:    dto.actualCostKes }                              : {}),
        ...(dto.status           !== undefined ? { status:           dto.status }                                     : {}),
        ...(dto.description      !== undefined ? { description:      dto.description }                                : {}),
        ...(dto.notes            !== undefined ? { notes:            dto.notes }                                      : {}),
      },
    });
  }
}
