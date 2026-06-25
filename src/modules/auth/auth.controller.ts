import { Controller, Post, Body, HttpCode, HttpStatus, Get, Put, Delete, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponse } from './interfaces/auth.interface';
import { JwtAuthGuard } from './jwt-auth.guard';
import { BotState, Plan } from '@database/entities';

const STANDARD_STATE_KEY = 'standard_subscriptions_enabled';
const ANTI_THROTTLING_STATE_KEY = 'anti_throttling_subscriptions_enabled';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(BotState)
    private readonly botStateRepository: Repository<BotState>,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
  ) {}

  private async getFlag(key: string): Promise<boolean> {
    const row = await this.botStateRepository.findOne({ where: { name: key } });
    return row ? row.enabled : true;
  }

  private async setFlag(key: string, value: boolean): Promise<boolean> {
    let row = await this.botStateRepository.findOne({ where: { name: key } });
    if (!row) {
      row = this.botStateRepository.create({ name: key, enabled: value });
    } else {
      row.enabled = value;
    }
    await this.botStateRepository.save(row);
    return row.enabled;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Авторизация администратора' })
  @ApiResponse({ 
    status: 200, 
    description: 'Успешная авторизация',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string', description: 'JWT токен' },
        expires_in: { type: 'number', description: 'Время жизни токена в секундах' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Неверный логин или пароль' })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    return this.authService.login(loginDto);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Текущие настройки' })
  async getSettings() {
    const [standardEnabled, antiThrottlingEnabled] = await Promise.all([
      this.getFlag(STANDARD_STATE_KEY),
      this.getFlag(ANTI_THROTTLING_STATE_KEY),
    ]);
    return { standardEnabled, antiThrottlingEnabled };
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Обновить настройки' })
  async updateSettings(@Body() body: { standardEnabled?: boolean; antiThrottlingEnabled?: boolean }) {
    if (body.standardEnabled !== undefined) {
      await this.setFlag(STANDARD_STATE_KEY, body.standardEnabled);
    }
    if (body.antiThrottlingEnabled !== undefined) {
      await this.setFlag(ANTI_THROTTLING_STATE_KEY, body.antiThrottlingEnabled);
    }
    const [standardEnabled, antiThrottlingEnabled] = await Promise.all([
      this.getFlag(STANDARD_STATE_KEY),
      this.getFlag(ANTI_THROTTLING_STATE_KEY),
    ]);
    return { standardEnabled, antiThrottlingEnabled };
  }

  // ─── Plan CRUD ───

  @Get('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Получить все тарифы' })
  async getPlans() {
    return this.planRepository.find({ order: { planType: 'ASC', sortOrder: 'ASC', price: 'ASC' } });
  }

  @Post('plans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Создать тариф' })
  async createPlan(@Body() body: Partial<Plan>) {
    const plan = this.planRepository.create(body);
    return this.planRepository.save(plan);
  }

  @Put('plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Обновить тариф' })
  async updatePlan(@Param('id') id: number, @Body() body: Partial<Plan>) {
    await this.planRepository.update(id, body);
    return this.planRepository.findOne({ where: { id } });
  }

  @Delete('plans/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Удалить тариф' })
  async deletePlan(@Param('id') id: number) {
    await this.planRepository.delete(id);
    return { success: true };
  }
}
