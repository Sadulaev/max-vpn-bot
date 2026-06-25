import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceSlotPlan } from '@database/entities';
import { CreateDeviceSlotPlanDto } from './dto/create-device-slot-plan.dto';
import { UpdateDeviceSlotPlanDto } from './dto/update-device-slot-plan.dto';

@Injectable()
export class DeviceSlotPlansService {
  constructor(
    @InjectRepository(DeviceSlotPlan)
    private readonly repo: Repository<DeviceSlotPlan>,
  ) {}

  findAll(): Promise<DeviceSlotPlan[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  findActive(): Promise<DeviceSlotPlan[]> {
    return this.repo.find({ where: { isActive: true }, order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async create(dto: CreateDeviceSlotPlanDto): Promise<DeviceSlotPlan> {
    const plan = this.repo.create({
      label: dto.label,
      slotsCount: dto.slotsCount,
      price: dto.price,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    });
    return this.repo.save(plan);
  }

  async update(id: number, dto: UpdateDeviceSlotPlanDto): Promise<DeviceSlotPlan> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`DeviceSlotPlan ${id} not found`);
    Object.assign(plan, dto);
    return this.repo.save(plan);
  }

  async remove(id: number): Promise<void> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`DeviceSlotPlan ${id} not found`);
    await this.repo.remove(plan);
  }
}
