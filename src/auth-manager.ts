import axios, { AxiosInstance } from 'axios';
import {
  BaserowAuthConfig,
  AuthTokenResponse,
  AuthRefreshResponse
} from './types/baserow';

/** Fallback lifetime when a JWT carries no readable `exp` claim. Baserow's default access-token lifetime is 10 minutes. */
const DEFAULT_JWT_LIFETIME_MS = 10 * 60 * 1000;
/** Refresh this long before the token actually expires. */
const EXPIRY_BUFFER_MS = 60 * 1000;

/** Read the `exp` claim (ms since epoch) out of a JWT without verifying it. */
function jwtExpiryMs(token: string): number | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class AuthManager {
  private config: BaserowAuthConfig;
  private axios: AxiosInstance;

  constructor(authConfig: BaserowAuthConfig, apiUrl: string) {
    this.config = { ...authConfig };
    this.axios = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Get the current authorization header value
   */
  async getAuthHeader(): Promise<string> {
    switch (this.config.type) {
      case 'jwt':
        return await this.getJwtAuthHeader();
      
      case 'credentials':
        return await this.getCredentialsAuthHeader();
      
      case 'database_token':
        if (!this.config.token) {
          throw new Error('Database token not provided');
        }
        return `Bearer ${this.config.token}`;
      
      default:
        throw new Error(`Unknown auth type: ${this.config.type}`);
    }
  }

  /** Whether a rejected token can be replaced without user input. */
  canRefresh(): boolean {
    return (
      this.config.type === 'credentials' ||
      (this.config.type === 'jwt' && !!this.config.refreshToken)
    );
  }

  /**
   * Force a new access token. Used when the API rejects the current one
   * (e.g. the server's token lifetime is shorter than we assumed).
   */
  async forceRefresh(): Promise<void> {
    if (this.config.type === 'credentials') {
      if (this.config.refreshToken) {
        try {
          await this.refreshToken();
          return;
        } catch {
          // fall through to a full login
        }
      }
      await this.login();
      return;
    }
    if (this.config.type === 'jwt' && this.config.refreshToken) {
      await this.refreshToken();
      return;
    }
    throw new Error('Cannot refresh token: no credentials or refresh token available');
  }

  private isExpiringSoon(): boolean {
    return !!this.config.tokenExpiry && Date.now() > this.config.tokenExpiry - EXPIRY_BUFFER_MS;
  }

  private applyAccessToken(token: string): void {
    this.config.token = token;
    this.config.tokenExpiry = jwtExpiryMs(token) ?? Date.now() + DEFAULT_JWT_LIFETIME_MS;
  }

  /**
   * Get JWT auth header, handling expiration
   */
  private async getJwtAuthHeader(): Promise<string> {
    if (!this.config.token) {
      throw new Error('JWT token not provided');
    }

    if (this.isExpiringSoon()) {
      if (this.config.refreshToken) {
        await this.refreshToken();
      } else {
        throw new Error('JWT token expired and no refresh token available');
      }
    }

    return `JWT ${this.config.token}`;
  }

  /**
   * Get auth header using credentials, auto-login if needed
   */
  private async getCredentialsAuthHeader(): Promise<string> {
    // If we don't have a token yet, login
    if (!this.config.token || !this.config.tokenExpiry) {
      await this.login();
    }

    if (this.isExpiringSoon()) {
      if (this.config.refreshToken) {
        await this.refreshToken();
      } else {
        // Re-login if refresh token is not available
        await this.login();
      }
    }

    return `JWT ${this.config.token}`;
  }

  /**
   * Login with username and password
   */
  private async login(): Promise<void> {
    if (!this.config.username || !this.config.password) {
      throw new Error('Username and password required for credentials auth');
    }

    try {
      const response = await this.axios.post<AuthTokenResponse>('/api/user/token-auth/', {
        username: this.config.username,
        password: this.config.password
      });

      this.applyAccessToken(response.data.token);
      this.config.refreshToken = response.data.refresh_token;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Login failed: ${error.response.data.detail || error.response.statusText}`);
      }
      throw error;
    }
  }

  /**
   * Refresh the JWT token
   */
  private async refreshToken(): Promise<void> {
    if (!this.config.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await this.axios.post<AuthRefreshResponse>('/api/user/token-refresh/', {
        refresh_token: this.config.refreshToken
      });

      this.applyAccessToken(response.data.token);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Refresh token is invalid, try to re-login if we have credentials
        if (this.config.type === 'credentials' && this.config.username && this.config.password) {
          await this.login();
        } else {
          throw new Error('Refresh token expired. Please re-authenticate.');
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Get current auth status and capabilities
   */
  getAuthStatus(): {
    type: string;
    isAuthenticated: boolean;
    hasGlobalAccess: boolean;
    tokenExpiry?: Date;
    capabilities: string[];
  } {
    const isAuthenticated = !!this.config.token || this.config.type === 'credentials';
    const hasGlobalAccess = this.config.type !== 'database_token';
    
    const capabilities: string[] = [];
    if (this.config.type === 'database_token') {
      capabilities.push('database_operations');
    } else {
      capabilities.push('workspace_management', 'database_operations', 'user_management', 'full_api_access');
    }

    return {
      type: this.config.type,
      isAuthenticated,
      hasGlobalAccess,
      tokenExpiry: this.config.tokenExpiry ? new Date(this.config.tokenExpiry) : undefined,
      capabilities
    };
  }

  /**
   * Manually set a new token (useful for MCP tool)
   */
  setToken(token: string, type: 'jwt' | 'database_token'): void {
    this.config.type = type;
    
    if (type === 'jwt') {
      this.applyAccessToken(token);
    } else {
      this.config.token = token;
      // Database tokens don't expire
      this.config.tokenExpiry = undefined;
    }
    
    // Clear credentials when manually setting token
    this.config.username = undefined;
    this.config.password = undefined;
    this.config.refreshToken = undefined;
  }

  /**
   * Set credentials for authentication
   */
  setCredentials(username: string, password: string): void {
    this.config.type = 'credentials';
    this.config.username = username;
    this.config.password = password;
    // Clear any existing tokens
    this.config.token = undefined;
    this.config.refreshToken = undefined;
    this.config.tokenExpiry = undefined;
  }
}
