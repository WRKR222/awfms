// src/modules/store/farm-hr.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CreateEmployeeDto {
  fullName: string;
  nationalId?: string;
  phone?: string;
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
  phone?: string;
  email?: string;
  role?: string;
  assignment?: string;
  houseIds?: string[];
  salaryKes?: number;
  payPeriod?: string;
  status?: string;
  terminatedDate?: string;
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

@Injectable()
export class FarmHRService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(status?: string) {
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
        nationalId:        dto.nationalId ?? null,
        phone:             dto.phone ?? null,
        email:             dto.email ?? null,
        role:              dto.role,
        assignment:        dto.assignment ?? null,
        houseIds:          dto.houseIds ?? [],
        salaryKes:         dto.salaryKes ?? 0,
        payPeriod:         dto.payPeriod ?? 'MONTHLY',
        hireDate:          new Date(dto.hireDate),
        nextOfKinName:     dto.nextOfKinName ?? null,
        nextOfKinPhone:    dto.nextOfKinPhone ?? null,
        nextOfKinRelation: dto.nextOfKinRelation ?? null,
        notes:             dto.notes ?? null,
      },
    });
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    await this.getEmployeeById(id);
    return this.prisma.farmEmployee.update({
      where: { id },
      data: {
        ...(dto.fullName          !== undefined ? { fullName:          dto.fullName }           : {}),
        ...(dto.phone             !== undefined ? { phone:             dto.phone }              : {}),
        ...(dto.email             !== undefined ? { email:             dto.email }              : {}),
        ...(dto.role              !== undefined ? { role:              dto.role }               : {}),
        ...(dto.assignment        !== undefined ? { assignment:        dto.assignment }         : {}),
        ...(dto.houseIds          !== undefined ? { houseIds:          dto.houseIds }           : {}),
        ...(dto.salaryKes         !== undefined ? { salaryKes:         dto.salaryKes }          : {}),
        ...(dto.payPeriod         !== undefined ? { payPeriod:         dto.payPeriod }          : {}),
        ...(dto.status            !== undefined ? { status:            dto.status as any }      : {}),
        ...(dto.terminatedDate    !== undefined ? { terminatedDate:    new Date(dto.terminatedDate) } : {}),
        ...(dto.nextOfKinName     !== undefined ? { nextOfKinName:     dto.nextOfKinName }      : {}),
        ...(dto.nextOfKinPhone    !== undefined ? { nextOfKinPhone:    dto.nextOfKinPhone }     : {}),
        ...(dto.nextOfKinRelation !== undefined ? { nextOfKinRelation: dto.nextOfKinRelation }  : {}),
        ...(dto.notes             !== undefined ? { notes:             dto.notes }              : {}),
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
        startDate:        new Date(dto.startDate),
        endDate:          dto.endDate ? new Date(dto.endDate) : null,
        contractorName:   dto.contractorName ?? null,
        contractorPhone:  dto.contractorPhone ?? null,
        budgetKes:        dto.budgetKes ?? 0,
        actualCostKes:    dto.actualCostKes ?? 0,
        status:           dto.status ?? 'IN_PROGRESS',
        description:      dto.description ?? null,
        notes:            dto.notes ?? null,
      },
    });
  }

  async updateConstruction(id: string, dto: UpdateConstructionDto) {
    await this.getConstructionById(id);
    return this.prisma.constructionRecord.update({
      where: { id },
      data: {
        ...(dto.title            !== undefined ? { title:            dto.title }              : {}),
        ...(dto.constructionType !== undefined ? { constructionType: dto.constructionType as any } : {}),
        ...(dto.location         !== undefined ? { location:         dto.location }           : {}),
        ...(dto.endDate          !== undefined ? { endDate:          dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.contractorName   !== undefined ? { contractorName:   dto.contractorName }     : {}),
        ...(dto.contractorPhone  !== undefined ? { contractorPhone:  dto.contractorPhone }    : {}),
        ...(dto.budgetKes        !== undefined ? { budgetKes:        dto.budgetKes }          : {}),
        ...(dto.actualCostKes    !== undefined ? { actualCostKes:    dto.actualCostKes }      : {}),
        ...(dto.status           !== undefined ? { status:           dto.status }             : {}),
        ...(dto.description      !== undefined ? { description:      dto.description }        : {}),
        ...(dto.notes            !== undefined ? { notes:            dto.notes }              : {}),
      },
    });
  }
}
