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

  /** Обновить пользователя (по uuid или username) */
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

  /** Получить пользователя по UUID */
  async getUserByUuid(uuid: string): Promise<RemnawaveUserResponse | null> {
    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users/${encodeURIComponent(uuid)}`, {
      method: 'GET',
      headers,
    });

    if (res.status === 404) return null;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave getUserByUuid failed (${res.status}): ${text}`);
    }

    const data: RemnawaveUserSingleResponse = await res.json();
    return data.response;
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

  /** Удалить пользователя по UUID */
  async deleteUser(uuid: string): Promise<boolean> {
    const headers = await this.authHeaders();

    const res = await fetch(`${this.apiUrl}/api/users/${encodeURIComponent(uuid)}`, {
      method: 'DELETE',
      headers,
    });

    if (res.status === 404) return false;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave deleteUser failed (${res.status}): ${text}`);
    }

    const data: RemnawaveDeleteResponse = await res.json();
    return data.response.isDeleted;
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
  async enableUser(uuid: string): Promise<void> {
    const headers = await this.authHeaders();
    const res = await fetch(`${this.apiUrl}/api/users/${encodeURIComponent(uuid)}/actions/enable`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave enableUser failed (${res.status}): ${text}`);
    }
  }

  /** Сбросить трафик пользователя */
  async resetTraffic(uuid: string): Promise<void> {
    const headers = await this.authHeaders();
    const res = await fetch(`${this.apiUrl}/api/users/${encodeURIComponent(uuid)}/actions/reset-traffic`, {
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

  /** Построить URL подписки для V2Ray клиента */
  buildSubscriptionUrl(shortUuid: string | null | undefined): string | null {
    if (!shortUuid) return null;
    return `${this.apiUrl}/api/sub/${shortUuid}`;
  }

  /** Построить URL страницы подписки (для показа пользователю) */
  buildSubPageUrl(shortUuid: string | null | undefined): string | null {
    if (!shortUuid) return null;
    if (this.subPageUrl) {
      return `${this.subPageUrl}/${shortUuid}`;
    }
    // Фоллбэк: используем API URL + /api/sub/{shortUuid}/info
    return `${this.apiUrl}/api/sub/${shortUuid}/info`;
  }

  /** Тег для типа подписки */
  getTag(): string {
    return 'STANDARD';
  }
}
