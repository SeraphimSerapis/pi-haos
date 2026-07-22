import type {
  ConfigCheckResult,
  HomeAssistantClientOptions,
  HomeAssistantCoreInfo,
  HomeAssistantService,
  HomeAssistantState,
} from './types.js';

export class HomeAssistantApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HomeAssistantApiError';
  }
}

export class HomeAssistantClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HomeAssistantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async getStates(): Promise<HomeAssistantState[]> {
    return this.request('/api/states');
  }

  async getEntityRegistry(): Promise<unknown[]> {
    return this.request('/api/config/entity_registry/list');
  }

  async getDeviceRegistry(): Promise<unknown[]> {
    return this.request('/api/config/device_registry/list');
  }

  async getAreaRegistry(): Promise<unknown[]> {
    return this.request('/api/config/area_registry/list');
  }

  async getServices(): Promise<HomeAssistantService> {
    return this.request('/api/services');
  }

  async getCoreInfo(): Promise<HomeAssistantCoreInfo> {
    return this.request('/api/config');
  }

  async renderTemplate(template: string): Promise<string> {
    return this.request('/api/template', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template }),
    });
  }

  async checkConfig(): Promise<ConfigCheckResult | string> {
    return this.request('/api/config/core/check');
  }

  async getErrorLog(): Promise<string> {
    return this.request('/api/error_log', { accept: 'text/plain' });
  }

  private async request<T>(
    path: string,
    init: RequestInit & { accept?: string } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set('accept', init.accept ?? 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok)
        throw new HomeAssistantApiError(
          response.status,
          `Home Assistant request failed (${response.status})`,
        );
      if (!text) return undefined as T;
      const contentType = response.headers.get('content-type') ?? '';
      return (contentType.includes('json') ? JSON.parse(text) : text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
