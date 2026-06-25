# Hyper VPN

Telegram бот для продажи VPN-подписок с интеграцией платёжной системы Robokassa и панелями управления 3x-ui.

## Архитектура

```
src/
├── common/
│   ├── config/          # Конфигурации приложения
│   ├── guards/          # Guards (проверка состояния бота)
│   └── interceptors/    # Interceptors (обработка ошибок)
├── database/
│   ├── entities/        # TypeORM entities
│   └── database.module.ts
├── modules/
│   ├── admin-bot/       # Админ-бот Telegram
│   ├── bot/             # Пользовательский бот
│   ├── google-sheets/   # Интеграция с Google Sheets
│   ├── payments/        # Платежи Robokassa
│   └── vpn-servers/     # Управление VPN-серверами
├── app.module.ts
└── main.ts
```

## Функциональность

### Пользовательский бот
- Покупка VPN подписок (1/3/6/12 месяцев)
- Просмотр активных ключей
- Инструкции по установке для всех платформ
- Интеграция с Robokassa для оплаты

## Установка

```bash
# Установка зависимостей
yarn install

# Копирование конфигурации
cp env.example.txt .env

# Запуск в режиме разработки
yarn start:dev

# Сборка для продакшена
yarn build
yarn start:prod
```

## Переменные окружения

```env
# Application
PORT=3000
NODE_ENV=development

# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=hyper_vpn

# Telegram Bots
TG_USER_BOT_TOKEN=your_user_bot_token
TG_ADMIN_BOT_TOKEN=your_admin_bot_token

# Robokassa
ROBOKASSA_MERCHANT_ID=your_merchant_id
ROBOKASSA_PASSWORD_1=your_password_1
ROBOKASSA_PASSWORD_2=your_password_2
ROBOKASSA_TEST_MODE=true

# Google Sheets (опционально)
GOOGLE_SHEETS_ID=your_spreadsheet_id
GOOGLE_SA_CLIENT_EMAIL=your_service_account_email
GOOGLE_SA_PRIVATE_KEY=your_private_key
```

## Endpoints

- `POST /payment/result` — Callback от Robokassa (ResultURL)
- `POST /payment/success` — Редирект после успешной оплаты
- `POST /payment/fail` — Редирект при неудачной оплате

## Безопасность

- ✅ Верификация подписи Robokassa
- ✅ Идемпотентная обработка платежей
- ✅ Валидация конфигурации
- ✅ Graceful error handling

## Технологии

- **NestJS** — фреймворк
- **nestjs-telegraf** — Telegram боты
- **TypeORM** — ORM для PostgreSQL
- **googleapis** — интеграция с Google Sheets

