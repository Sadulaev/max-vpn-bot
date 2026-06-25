import { PartialType } from '@nestjs/swagger';
import { CreateDeviceSlotPlanDto } from './create-device-slot-plan.dto';

export class UpdateDeviceSlotPlanDto extends PartialType(CreateDeviceSlotPlanDto) {}
