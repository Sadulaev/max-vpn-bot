import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SiteUser } from '@database/entities';

const SALT_ROUNDS = 10;

@Injectable()
export class SiteAuthService {
  constructor(
    @InjectRepository(SiteUser)
    private readonly users: Repository<SiteUser>,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<{ access_token: string; email: string }> {
    const existing = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('Аккаунт с таким email уже существует');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = this.users.create({ email: email.toLowerCase(), passwordHash });
    await this.users.save(user);

    const token = this.jwt.sign({ sub: user.id, email: user.email });
    return { access_token: token, email: user.email };
  }

  async login(email: string, password: string): Promise<{ access_token: string; email: string }> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('Аккаунт с таким email не найден');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Неверный пароль');
    }

    const token = this.jwt.sign({ sub: user.id, email: user.email });
    return { access_token: token, email: user.email };
  }

  async getMe(userId: string): Promise<{ email: string; createdAt: Date }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { email: user.email, createdAt: user.createdAt };
  }
}
