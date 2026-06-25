import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceSlotPlan } from '@database/entities';
import { DeviceSlotPlansController } from './device-slot-plans.controller';
import { DeviceSlotPlansService } from './device-slot-plans.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceSlotPlan])],
  controllers: [DeviceSlotPlansController],
  providers: [DeviceSlotPlansService],
  exports: [DeviceSlotPlansService],
})
export class DeviceSlotPlansModule {}
