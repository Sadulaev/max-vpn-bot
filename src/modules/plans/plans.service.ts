import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from '@database/entities';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
  ) {}

  findAll(planType?: string): Promise<Plan[]> {
    return this.planRepository.find({
      where: planType === 'standard' || planType === 'anti-throttling'
        ? { planType }
        : undefined,
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Plan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Тариф #${id} не найден`);
    return plan;
  }

  create(dto: CreatePlanDto): Promise<Plan> {
    const plan = this.planRepository.create({
      ...dto,
      dataLimitGB: dto.dataLimitGB ?? 0,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
      isMain: dto.isMain ?? true,
    });
    return this.planRepository.save(plan);
  }

  async update(id: number, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.findOne(id);
    Object.assign(plan, dto);
    return this.planRepository.save(plan);
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.planRepository.delete(id);
  }
}
