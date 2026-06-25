// ============= APP CONFIG =============
export interface AppConfig {
  port: number;
  nodeEnv: string;
  baseUrl: string;
}

// ============= DATABASE CONFIG =============
export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

// ============= TELEGRAM CONFIG =============
export interface TelegramConfig {
  userBotToken: string;
  notificationChannelId: string;
}

// ============= MAX CONFIG =============
export interface MaxConfig {
  apiUrl: string;
  botToken: string;
  webhookSecret: string;
  botUsername: string;
  referralBaseUrl: string;
}

// ============= FREEKASSA CONFIG =============
export interface FreekassaConfig {
  shopId: number;
  secretWord: string;
  secretWord2: string;
  apiKey: string;
  serverIp: string;
}

// ============= REMNAWAVE CONFIG =============
export interface RemnawaveConfig {
  apiUrl: string;
  apiToken: string;
  standardSquadUuid: string;
  antiThrottlingSquadUuid: string;
  subPageUrl: string;
}

// ============= MAIN CONFIG =============
export interface Config {
  app: AppConfig;
  database: DatabaseConfig;
  telegram: TelegramConfig;
  max: MaxConfig;
  freekassa: FreekassaConfig;
  remnawave: RemnawaveConfig;
}

// ============= CONFIG FACTORY =============
export default (): Config => ({
  app: {
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    baseUrl: process.env.BASE_URL || "http://localhost:3000",
  },
  database: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    username: process.env.DB_USERNAME || "vpn",
    password: process.env.DB_PASSWORD || "neron",
    database: process.env.DB_NAME || "santa_vpn",
  },
  telegram: {
    userBotToken: process.env.TG_USER_BOT_TOKEN || "",
    notificationChannelId: process.env.TG_NOTIFICATION_CHANNEL_ID || "",
  },
  max: {
    apiUrl: process.env.MAX_API_URL || 'https://platform-api2.max.ru',
    botToken: process.env.MAX_BOT_TOKEN || '',
    webhookSecret: process.env.MAX_WEBHOOK_SECRET || '',
    botUsername: process.env.MAX_BOT_USERNAME || '',
    referralBaseUrl: process.env.MAX_REFERRAL_BASE_URL || process.env.REMNAWAVE_SUB_PAGE_URL || process.env.BASE_URL || '',
  },
  freekassa: {
    shopId: parseInt(process.env.FREEKASSA_SHOP_ID || '0', 10),
    secretWord: process.env.FREEKASSA_SECRET_WORD || '',
    secretWord2: process.env.FREEKASSA_SECRET_WORD2 || '',
    apiKey: process.env.FREEKASSA_API_KEY || '',
    serverIp: process.env.SERVER_IP || '',
  },
  remnawave: {
    apiUrl: process.env.REMNAWAVE_API_URL || '',
    apiToken: process.env.REMNAWAVE_API_TOKEN || '',
    standardSquadUuid: process.env.REMNAWAVE_STANDARD_SQUAD_UUID || '',
    antiThrottlingSquadUuid: process.env.REMNAWAVE_ANTI_THROTTLING_SQUAD_UUID || '',
    subPageUrl: process.env.REMNAWAVE_SUB_PAGE_URL || '',
  },
});
