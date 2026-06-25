export interface JwtPayload {
  username: string;
  iat?: number;
  exp?: number;
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
}
