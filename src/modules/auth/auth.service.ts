import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { AuthResponse, JwtPayload } from './interfaces/auth.interface';

@Injectable()
export class AuthService {
  // Статичные учетные данные (в production лучше хранить в БД)
  private readonly adminUsername: string;
  private readonly adminPasswordHash: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    // Получаем из env или используем дефолтные
    this.adminUsername = this.configService.get<string>('ADMIN_USERNAME', 'admin');
    
    // Пароль из env или дефолтный
    const adminPassword = this.configService.get<string>('ADMIN_PASSWORD', 'admin123');
    
    // Хешируем пароль при инициализации
    this.adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
  }

  async validateUser(username: string, password: string): Promise<boolean> {
    if (username !== this.adminUsername) {
      return false;
    }

    return bcrypt.compareSync(password, this.adminPasswordHash);
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const isValid = await this.validateUser(loginDto.username, loginDto.password);

    if (!isValid) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const payload: JwtPayload = { username: loginDto.username };
    const expiresIn = 6 * 60 * 60; // 6 часов в секундах

    return {
      access_token: this.jwtService.sign(payload),
      expires_in: expiresIn,
    };
  }

  async validateToken(payload: JwtPayload): Promise<{ username: string }> {
    // Дополнительная проверка что пользователь существует
    if (payload.username === this.adminUsername) {
      return { username: payload.username };
    }
    throw new UnauthorizedException('Недействительный токен');
  }
}
