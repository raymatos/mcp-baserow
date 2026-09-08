import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import {
  BaserowConfig,
  Workspace,
  Application,
  Database,
  Table,
  Field,
  Row,
  PaginationParams,
  PaginatedResponse,
  BaserowError,
  CreateWorkspaceParams,
  CreateDatabaseParams,
  CreateTableParams,
  CreateRowParams,
  UpdateRowParams,
  BatchCreateRowsParams,
  BatchUpdateRowsParams,
  BatchDeleteRowsParams,
  CreateFieldParams,
  UpdateFieldParams,
  ApiToken,
  ApiTokenPermissions,
  CreateApiTokenParams,
  UpdateApiTokenParams
} from './types/baserow';
import { AuthManager } from './auth-manager.js';

type RetryableRequestConfig = AxiosRequestConfig & { _authRetried?: boolean };

export class BaserowClient {
  private axios: AxiosInstance;
  private config: BaserowConfig;
  private authManager: AuthManager;

  constructor(config: BaserowConfig) {
    this.config = config;
    this.authManager = new AuthManager(config.auth, config.apiUrl);
    
    this.axios = axios.create({
      baseURL: config.apiUrl,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add auth interceptor to inject authorization header
    this.axios.interceptors.request.use(
      async (config) => {
        const authHeader = await this.authManager.getAuthHeader();
        config.headers.Authorization = authHeader;
        return config;
      },
      (error) => Promise.reject(error)
    );

    // On a rejected access token, refresh once and replay the request.
    // Baserow's access-token lifetime is configurable server-side, so the
    // token can be rejected before our locally tracked expiry.
    this.axios.interceptors.response.use(
      response => response,
      async (error: AxiosError<BaserowError>) => {
        const cfg = error.config as RetryableRequestConfig | undefined;
        const isAuthError =
          error.response?.status === 401 ||
          error.response?.data?.error === 'ERROR_INVALID_ACCESS_TOKEN';
        if (isAuthError && cfg && !cfg._authRetried && this.authManager.canRefresh()) {
          cfg._authRetried = true;
          await this.authManager.forceRefresh();
          return this.axios.request(cfg);
        }
        return this.handleError(error);
      }
    );
  }

  private handleError(error: AxiosError<BaserowError>): Promise<never> {
    if (error.response?.data) {
      const errorData = error.response.data;
      const message = typeof errorData.detail === 'string' 
        ? errorData.detail 
        : JSON.stringify(errorData.detail);
      
      throw new Error(`Baserow API Error [${errorData.error}]: ${message}`);
    }
    throw error;
  }

  // Workspace operations
  async listWorkspaces(): Promise<Workspace[]> {
    const response = await this.axios.get<Workspace[]>('/api/workspaces/');
    return response.data;
  }

  async getWorkspace(workspaceId: number): Promise<Workspace> {
    const response = await this.axios.get<Workspace>(`/api/workspaces/${workspaceId}/`);
    return response.data;
  }

  async createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
    const response = await this.axios.post<Workspace>('/api/workspaces/', params);
    return response.data;
  }

  // Database/Application operations
  async listDatabases(workspaceId?: number): Promise<Database[]> {
    const url = workspaceId 
      ? `/api/applications/workspace/${workspaceId}/`
      : '/api/applications/';
    
    const response = await this.axios.get<Application[]>(url);
    return response.data.filter(app => app.type === 'database') as Database[];
  }

  async getDatabase(databaseId: number): Promise<Database> {
    const response = await this.axios.get<Database>(`/api/applications/${databaseId}/`);
    return response.data;
  }

  async createDatabase(params: CreateDatabaseParams): Promise<Database> {
    const response = await this.axios.post<Database>(
      `/api/applications/workspace/${params.workspace_id}/`,
      {
        name: params.name,
        type: 'database'
      }
    );
    return response.data;
  }

  // Table operations
  async listTables(databaseId: number): Promise<Table[]> {
    const response = await this.axios.get<Table[]>(
      `/api/database/tables/database/${databaseId}/`
    );
    return response.data;
  }

  async getTable(tableId: number): Promise<Table> {
    const response = await this.axios.get<Table>(`/api/database/tables/${tableId}/`);
    return response.data;
  }

  async createTable(params: CreateTableParams): Promise<Table> {
    const response = await this.axios.post<Table>(
      `/api/database/tables/database/${params.database_id}/`,
      { name: params.name }
    );
    return response.data;
  }

  async getTableFields(tableId: number): Promise<Field[]> {
    const response = await this.axios.get<Field[]>(
      `/api/database/fields/table/${tableId}/`
    );
    return response.data;
  }

  // Field operations
  async createField(params: CreateFieldParams): Promise<Field> {
    const response = await this.axios.post<Field>(
      `/api/database/fields/table/${params.table_id}/`,
      { name: params.name, type: params.type, ...(params.options || {}) }
    );
    return response.data;
  }

  async updateField(params: UpdateFieldParams): Promise<Field> {
    const body: Record<string, any> = { ...(params.options || {}) };
    if (params.name !== undefined) body.name = params.name;
    if (params.type !== undefined) body.type = params.type;
    const response = await this.axios.patch<Field>(
      `/api/database/fields/${params.field_id}/`,
      body
    );
    return response.data;
  }

  async deleteField(fieldId: number): Promise<void> {
    await this.axios.delete(`/api/database/fields/${fieldId}/`);
  }

  // Database (API) token operations — require JWT/credentials auth, not a database token
  async listApiTokens(): Promise<ApiToken[]> {
    const response = await this.axios.get<ApiToken[]>('/api/database/tokens/');
    return response.data;
  }

  async createApiToken(params: CreateApiTokenParams): Promise<ApiToken> {
    const response = await this.axios.post<ApiToken>('/api/database/tokens/', {
      name: params.name,
      workspace: params.workspace_id
    });
    let token = response.data;
    if (params.permissions) {
      // Baserow creates tokens with full access; anything not granted here is denied.
      const permissions: ApiTokenPermissions = {
        create: params.permissions.create ?? false,
        read: params.permissions.read ?? false,
        update: params.permissions.update ?? false,
        delete: params.permissions.delete ?? false
      };
      const updated = await this.updateApiToken({ token_id: token.id, permissions });
      token = { ...updated, key: updated.key ?? token.key };
    }
    return token;
  }

  async updateApiToken(params: UpdateApiTokenParams): Promise<ApiToken> {
    const body: Record<string, any> = {};
    if (params.name !== undefined) body.name = params.name;
    if (params.permissions !== undefined) body.permissions = params.permissions;
    if (params.rotate_key) body.rotate_key = true;
    const response = await this.axios.patch<ApiToken>(
      `/api/database/tokens/${params.token_id}/`,
      body
    );
    return response.data;
  }

  async deleteApiToken(tokenId: number): Promise<void> {
    await this.axios.delete(`/api/database/tokens/${tokenId}/`);
  }

  // Row operations
  async listRows(
    tableId: number, 
    params?: PaginationParams
  ): Promise<PaginatedResponse<Row>> {
    const response = await this.axios.get<PaginatedResponse<Row>>(
      `/api/database/rows/table/${tableId}/`,
      { params }
    );
    return response.data;
  }

  async getRow(tableId: number, rowId: number): Promise<Row> {
    const response = await this.axios.get<Row>(
      `/api/database/rows/table/${tableId}/${rowId}/`
    );
    return response.data;
  }

  async createRow(params: CreateRowParams): Promise<Row> {
    const response = await this.axios.post<Row>(
      `/api/database/rows/table/${params.table_id}/`,
      params.data
    );
    return response.data;
  }

  async updateRow(params: UpdateRowParams): Promise<Row> {
    const response = await this.axios.patch<Row>(
      `/api/database/rows/table/${params.table_id}/${params.row_id}/`,
      params.data
    );
    return response.data;
  }

  async deleteRow(tableId: number, rowId: number): Promise<void> {
    await this.axios.delete(
      `/api/database/rows/table/${tableId}/${rowId}/`
    );
  }

  // Batch operations
  async batchCreateRows(params: BatchCreateRowsParams): Promise<Row[]> {
    const response = await this.axios.post<{ items: Row[] }>(
      `/api/database/rows/table/${params.table_id}/batch/`,
      { items: params.rows }
    );
    return response.data.items;
  }

  async batchUpdateRows(params: BatchUpdateRowsParams): Promise<Row[]> {
    const response = await this.axios.patch<{ items: Row[] }>(
      `/api/database/rows/table/${params.table_id}/batch/`,
      { items: params.rows }
    );
    return response.data.items;
  }

  async batchDeleteRows(params: BatchDeleteRowsParams): Promise<void> {
    await this.axios.post(
      `/api/database/rows/table/${params.table_id}/batch-delete/`,
      { items: params.row_ids }
    );
  }

  // Configuration
  setActiveWorkspace(workspaceId: number): void {
    this.config.activeWorkspaceId = workspaceId;
  }

  getActiveWorkspace(): number | undefined {
    return this.config.activeWorkspaceId;
  }

  // Authentication management
  getAuthManager(): AuthManager {
    return this.authManager;
  }
}