import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@modules/auth';
import { DeviceSlotPlansService } from './device-slot-plans.service';
import { CreateDeviceSlotPlanDto } from './dto/create-device-slot-plan.dto';
import { UpdateDeviceSlotPlanDto } from './dto/update-device-slot-plan.dto';

@ApiTags('Device Slot Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('device-slot-plans')
export class DeviceSlotPlansController {
  constructor(private readonly service: DeviceSlotPlansService) {}

  @Get()
  @ApiOperation({ summary: 'Получить все тарифы слотов устройств' })
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Создать тариф слота устройств' })
  create(@Body() dto: CreateDeviceSlotPlanDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить тариф слота устройств' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeviceSlotPlanDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить тариф слота устройств' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
