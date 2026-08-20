import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RemnawaveUserCreate,
  RemnawaveUserUpdate,
  RemnawaveUserResponse,
  RemnawaveUsersResponse,
  RemnawaveUserSingleResponse,
  RemnawaveDeleteResponse,
  RemnawaveHwidDevice,
  RemnawaveHwidDevicesResponse,
} from './interfaces/remnawave-api.interface';

@Injectable()
export class RemnawaveApiService implements OnModuleInit {
  private readonly logger = new Logger(RemnawaveApiService.name);

  private apiUrl!: string;
  private apiToken!: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  /** UUID сквада для стандартных подписок */
  private standardSquadUuid!: string;
  /** UUID сквада для антиглушилки */
  private antiThrottlingSquadUuid!: string;
  /** Base URL страницы подписки (фронтенд) */
  private subPageUrl!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.apiUrl = this.configService.get<string>('remnawave.apiUrl', '');
    this.apiToken = this.configService.get<string>('remnawave.apiToken', '');
    this.standardSquadUuid = this.configService.get<string>('remnawave.standardSquadUuid', '');
    this.antiThrottlingSquadUuid = this.configService.get<string>('remnawave.antiThrottlingSquadUuid', '');
    this.subPageUrl = (this.configService.get<string>('remnawave.subPageUrl', '') ?? '').replace(/\/+$/, '');

    if (!this.apiUrl) {
      this.logger.warn('REMNAWAVE_API_URL is not set — Remnawave integration disabled');
    }
    if (!this.apiToken) {
      this.logger.warn('REMNAWAVE_API_TOKEN is not set — Remnawave integration disabled');
    }
    if (this.apiUrl && !this.subPageUrl) {
      this.logger.warn(
        'REMNAWAVE_SUB_PAGE_URL is not set — users will see REMNAWAVE_API_URL/api/sub/... links',
      );
    } else if (this.subPageUrl) {
      this.logger.log(`Remnawave public sub page: ${this.subPageUrl}/{shortUuid}`);
    }
  }

  /** Проверить, настроен ли Remnawave */
  isConfigured(): boolean {
    return !!(this.apiUrl && this.apiToken);
  }

  /** UUID сквада для данного типа подписки */
  getSquadUuid(): string {
    return this.standardSquadUuid;
  }

  // ─── Auth ───

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  // ─── Users ───

  /** Числовой id Remnawave (в колонке remnawaveUuid теперь храним его как строку) */
  parseNumericUserId(value: string | null | undefined): number | null {
    if (!value || !/^\d+$/.test(value)) return null;
    const id = Number(value);
    return Number.isFinite(id) ? id : null;
  }

  /** Ключ для сохранения в remnawaveUuid после ответа Remnawave */
  getStoredUserId(user: RemnawaveUserResponse): string {
    return String(user.id);
  }

  /** Создать пользователя в Remnawave */
  async createUser(dto: RemnawaveUserCreate): Promise<RemnawaveUserResponse> {
    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify(dto),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave createUser failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
  }

  /** Обновить пользователя (по id или username) */
  async updateUser(dto: RemnawaveUserUpdate): Promise<RemnawaveUserResponse> {
    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(dto),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave updateUser failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
  }

  /**
   * Получить пользователя по числовому id.
   * Новые версии Remnawave: GET /api/users/by-id/:id
   * (GET /api/users/:userId ожидает number — UUID даёт 400 NaN)
   */
  async getUserById(id: number): Promise<RemnawaveUserResponse | null> {
    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users/by-id/${id}`, {
      method: 'GET',
      headers,
    });

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getUserById failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
  }

  /**
   * Back-compat: remnawaveUuid раньше был UUID, теперь — числовой id строкой.
   * Старые UUID больше нельзя запрашивать через /api/users/:id.
   */
  async getUserByUuid(idOrUuid: string): Promise<RemnawaveUserResponse | null> {
    const id = this.parseNumericUserId(idOrUuid);
    if (id == null) return null;
    return this.getUserById(id);
  }

  /** Получить пользователя по username */
  async getUserByUsername(username: string): Promise<RemnawaveUserResponse | null> {
    const headers = await this.authHeaders();

    const res = await fetch(
      `${this.apiUrl}/api/users/by-username/${encodeURIComponent(username)}`,
      { method: 'GET', headers },
    );

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getUserByUsername failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
  }

  /** Получить пользователя по short UUID */
  async getUserByShortUuid(shortUuid: string): Promise<RemnawaveUserResponse | null> {
    const headers = await this.authHeaders();

    const res = await fetch(
      `${this.apiUrl}/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`,
      { method: 'GET', headers },
    );

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getUserByShortUuid failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
  }

  /** Удалить пользователя по числовому id (или строке с числом) */
  async deleteUser(idOrUuid: string): Promise<boolean> {
    const id = this.parseNumericUserId(idOrUuid);
    if (id == null) {
      this.logger.warn(
        `Remnawave deleteUser skipped: expected numeric id, got "${idOrUuid}"`,
      );
      return false;
    }

    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users/${id}`, {
      method: 'DELETE',
      headers,
    });

    if (res.status === 404) return false;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave deleteUser failed (${res.status}): ${text}`);
    }

    // Новые версии отдают 204 No Content
    if (res.status === 204) return true;

    try {
      const data: RemnawaveDeleteResponse = await res.json();
      return data.response?.isDeleted ?? true;
    } catch {
      return true;
    }
  }

  /** Получить список всех пользователей с пагинацией */
  async getUsers(start = 0, size = 100): Promise<{ users: RemnawaveUserResponse[]; total: number }> {
    const headers = await this.authHeaders();

    const url = new URL(`${this.apiUrl}/api/users`);
    url.searchParams.set('start', String(start));
    url.searchParams.set('size', String(size));

    const res = await fetch(url.toString(), { method: 'GET', headers });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getUsers failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUsersResponse = await res.json();
    return data.response;
  }

  /** Включить пользователя (статус ACTIVE) */
  async enableUser(idOrUuid: string): Promise<void> {
    const id = this.parseNumericUserId(idOrUuid);
    if (id == null) {
      throw new Error(`Remnawave enableUser expects numeric id, got "${idOrUuid}"`);
    }

    const headers = await this.authHeaders();
    const res = await fetch(`${this.apiUrl}/api/users/${id}/actions/enable`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave enableUser failed (${res.status}): ${text}`);
    }
  }

  /** Сбросить трафик пользователя */
  async resetTraffic(idOrUuid: string): Promise<void> {
    const id = this.parseNumericUserId(idOrUuid);
    if (id == null) {
      throw new Error(`Remnawave resetTraffic expects numeric id, got "${idOrUuid}"`);
    }

    const headers = await this.authHeaders();
    const res = await fetch(`${this.apiUrl}/api/users/${id}/actions/reset-traffic`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave resetTraffic failed (${res.status}): ${text}`);
    }
  }

  // ─── Nodes ───

  /** Получить список всех нод */
  async getNodes(): Promise<any[]> {
    const headers = await this.authHeaders();
    const res = await fetch(`${this.apiUrl}/api/nodes`, { method: 'GET', headers });
    if (!res.ok) return [];
    const data = await res.json();
    return data.response ?? [];
  }

  // ─── HWID Devices ───

  /** Получить список HWID-устройств пользователя */
  async getHwidDevices(userUuid: string): Promise<RemnawaveHwidDevice[]> {
    const headers = await this.authHeaders();

    const res = await fetch(
      `${this.apiUrl}/api/hwid/devices/${encodeURIComponent(userUuid)}`,
      { method: 'GET', headers },
    );

    if (res.status === 404) return [];

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getHwidDevices failed (${res.status}): ${text}`);
    }

    const data: RemnawaveHwidDevicesResponse = await res.json();
    return data.response?.devices ?? [];
  }

  /** Удалить HWID-устройство пользователя */
  async deleteHwidDevice(userUuid: string, hwid: string): Promise<boolean> {
    const headers = await this.authHeaders();

    const res = await fetch(
      `${this.apiUrl}/api/hwid/devices/delete`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ userUuid, hwid }),
      },
    );

    if (res.status === 404) return false;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave deleteHwidDevice failed (${res.status}): ${text}`);
    }

    return true;
  }

  // ─── Subscription URLs ───

  /**
   * Публичный URL подписки для клиентов / пользователей.
   * Если задан REMNAWAVE_SUB_PAGE_URL — используем его (не светим admin API).
   */
  buildSubscriptionUrl(shortUuid: string | null | undefined): string | null {
    if (!shortUuid) return null;
    if (this.subPageUrl) {
      return `${this.subPageUrl}/${shortUuid}`;
    }
    return `${this.apiUrl}/api/sub/${shortUuid}`;
  }

  /** URL страницы подписки (для кнопки в боте) */
  buildSubPageUrl(shortUuid: string | null | undefined): string | null {
    if (!shortUuid) return null;
    if (this.subPageUrl) {
      return `${this.subPageUrl}/${shortUuid}`;
    }
    // Фоллбэк: API URL + /api/sub/{shortUuid}/info
    return `${this.apiUrl}/api/sub/${shortUuid}/info`;
  }

  /** Тег для типа подписки */
  getTag(): string {
    return 'STANDARD';
  }
}
