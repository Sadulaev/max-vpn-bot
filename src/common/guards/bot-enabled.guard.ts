import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';

/**
 * Guard для проверки, включен ли бот.
 * TODO: реализовать логику через конфиг или БД если потребуется.
 */
@Injectable()
export class BotEnabledGuard implements CanActivate {
  private readonly logger = new Logger(BotEnabledGuard.name);

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    // Пока всегда разрешаем (admin-bot удалён)
    return true;
  }
}

