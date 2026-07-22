export interface PiCapabilities {
  rpcProtocolVersion: string;
  supportsSessionSwitching: boolean;
  supportsToolWhitelisting: boolean;
  supportsModelSwitching: boolean;
  supportsStructuredEvents: boolean;
  supportsCancellation: boolean;
}

export interface PiVersionInfo {
  version: string;
  source: 'bundled' | 'managed';
  path: string;
}

export interface PiHealthStatus {
  healthy: boolean;
  version: PiVersionInfo | null;
  capabilities: PiCapabilities | null;
  activeSessions: number;
  error?: string;
}

export interface StartSessionOptions {
  sessionId?: string;
  workspace: string;
  model?: { provider: string; modelId: string };
  skills?: string[];
  brokerPort?: number;
  /** One-time bearer token for the trusted structured-tool broker. */
  toolToken?: string;
  /** Loopback URL used by the Pi extension to reach the broker. */
  toolBrokerUrl?: string;
}

export interface SessionInfo {
  id: string;
  workspace: string;
  startedAt: string;
  status: 'starting' | 'idle' | 'streaming' | 'crashed' | 'closed';
}

export type AgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolName: string; toolCallId?: string }
  | { type: 'tool_update'; toolName: string; update: unknown }
  | { type: 'tool_end'; toolName: string; isError: boolean; result?: unknown }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string };

export interface PiRuntime {
  startSession(options: StartSessionOptions): Promise<SessionInfo>;
  sendMessage(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  cancelTurn(sessionId: string): Promise<void>;
  listModels(): Promise<unknown[]>;
  switchModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<void>;
  getVersion(): Promise<PiVersionInfo>;
  healthCheck(): Promise<PiHealthStatus>;
  closeSession(sessionId: string): Promise<void>;
}

export interface RpcResponse {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}
