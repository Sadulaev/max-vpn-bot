// ─── Auth ───

export interface RemnawaveLoginResponse {
  response: {
    accessToken: string;
  };
}

// ─── User ───

export type RemnawaveUserStatus = 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';

export interface RemnawaveSquad {
  uuid: string;
  name: string;
}

export interface RemnawaveUserTraffic {
  usedTrafficBytes: number;
  lifetimeUsedTrafficBytes: number;
  onlineAt: string | null;
  firstConnectedAt: string | null;
  lastConnectedNodeUuid: string | null;
}

export interface RemnawaveUserResponse {
  uuid: string;
  id: number;
  shortUuid: string;
  username: string;
  status: RemnawaveUserStatus;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  expireAt: string;
  telegramId: number | null;
  email: string | null;
  description: string | null;
  tag: string | null;
  hwidDeviceLimit: number | null;
  externalSquadUuid: string | null;
  trojanPassword: string;
  vlessUuid: string;
  ssPassword: string;
  lastTriggeredThreshold: number;
  subRevokedAt: string | null;
  lastTrafficResetAt: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionUrl: string;
  activeInternalSquads: RemnawaveSquad[];
  userTraffic: RemnawaveUserTraffic;
}

export interface RemnawaveUsersResponse {
  response: {
    users: RemnawaveUserResponse[];
    total: number;
  };
}

export interface RemnawaveUserSingleResponse {
  response: RemnawaveUserResponse;
}

export interface RemnawaveDeleteResponse {
  response: {
    isDeleted: boolean;
  };
}

// ─── Create / Update DTOs ───

export interface RemnawaveUserCreate {
  username: string;
  /** ISO datetime string: 2025-01-17T15:38:45.065Z */
  expireAt: string;
  status?: RemnawaveUserStatus;
  shortUuid?: string;
  trafficLimitBytes?: number;
  trafficLimitStrategy?: 'NO_RESET' | 'DAY' | 'WEEK' | 'MONTH' | 'MONTH_ROLLING';
  description?: string;
  tag?: string | null;
  telegramId?: number | null;
  activeInternalSquads?: string[];
  hwidDeviceLimit?: number | null;
}

export interface RemnawaveUserUpdate {
  /** Identify user by username */
  username?: string;
  /** Or identify by UUID (higher priority) */
  uuid?: string;
  status?: 'ACTIVE' | 'DISABLED';
  trafficLimitBytes?: number;
  trafficLimitStrategy?: 'NO_RESET' | 'DAY' | 'WEEK' | 'MONTH' | 'MONTH_ROLLING';
  expireAt?: string;
  description?: string | null;
  tag?: string | null;
  telegramId?: number | null;
  activeInternalSquads?: string[];
  hwidDeviceLimit?: number | null;
}

// ─── HWID Devices ───

export interface RemnawaveHwidDevice {
  hwid: string;
  userUuid: string;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RemnawaveHwidDevicesResponse {
  response: {
    total: number;
    devices: RemnawaveHwidDevice[];
  };
}
