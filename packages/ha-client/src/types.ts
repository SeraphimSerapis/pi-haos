export interface HomeAssistantClientOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface HomeAssistantState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context?: Record<string, unknown>;
}

export interface HomeAssistantService {
  [domain: string]: Record<
    string,
    { description?: string; fields?: Record<string, unknown> }
  >;
}

export interface HomeAssistantCoreInfo {
  message?: string;
  version?: string;
  [key: string]: unknown;
}

export interface TemplateRequest {
  template: string;
}

export interface ConfigCheckResult {
  result?: string;
  errors?: string | null;
  [key: string]: unknown;
}
