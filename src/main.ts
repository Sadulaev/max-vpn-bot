import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Создаём необходимые директории
  const sessionsDir = join(process.cwd(), 'sessions');
  const assetsDir = join(process.cwd(), 'assets');

  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
    logger.log('Created sessions directory');
  }

  if (!existsSync(assetsDir)) {
    mkdirSync(assetsDir, { recursive: true });
    logger.log('Created assets directory');
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Глобальная обработка ошибок
  process.on('unhandledRejection', (reason: any) => {
    logger.error(`Unhandled Rejection: ${reason?.stack || reason}`);
  });

  process.on('uncaughtException', (error: any) => {
    logger.error(`Uncaught Exception: ${error?.stack || error}`);
  });

  const configService = app.get(ConfigService);
  const appConfig = configService.get('app');
  const port = appConfig?.port || 3000;
  const isProduction = appConfig?.nodeEnv === 'production';

  // Global prefix для API (исключая публичный эндпоинт /sub/:clientId)
  app.setGlobalPrefix('api', {
    exclude: ['sub/:clientId', 'payment/webhook', 'max/webhook'],
  });

  // Swagger только для development (после установки префикса)
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VPN HIT API')
      .setDescription('API для управления подписками')
      .setVersion('1.0')
      .addTag('Subscriptions', 'Управление подписками')
      .addTag('Payments', 'Обработка платежей FreeKassa')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('📖 Swagger enabled for development');
  } else {
    logger.log('📖 Swagger disabled (production mode)');
  }

  // CORS настройки
  app.enableCors({
    origin: [
      'http://localhost:5173', // Vite dev server
      'http://localhost:3001',
      'http://localhost:5174',
      'https://vpnhit.ru',
      appConfig?.baseUrl,
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Access-Token'],
  });

  // Валидация DTO
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(port);

  logger.log(`🚀 Application is running on port ${port}`);
  logger.log(`📊 Environment: ${appConfig?.nodeEnv}`);
  logger.log(`🌐 Base URL: ${appConfig?.baseUrl}`);
  
  if (!isProduction) {
    logger.log(`📖 Swagger docs: http://localhost:${port}/api/docs`);
  }
}

bootstrap();

