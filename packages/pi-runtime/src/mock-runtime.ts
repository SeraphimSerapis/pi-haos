import type {
  AgentEvent,
  PiCapabilities,
  PiHealthStatus,
  PiRuntime,
  PiVersionInfo,
  SessionInfo,
  StartSessionOptions,
} from './types.js';

const version: PiVersionInfo = {
  version: 'mock-0.1.0',
  source: 'bundled',
  path: 'mock',
};
const capabilities: PiCapabilities = {
  rpcProtocolVersion: 'mock-1',
  supportsSessionSwitching: true,
  supportsToolWhitelisting: true,
  supportsModelSwitching: true,
  supportsStructuredEvents: true,
  supportsCancellation: true,
};

export class MockPiRuntime implements PiRuntime {
  private readonly sessions = new Map<string, SessionInfo>();
  private sequence = 0;

  async startSession(options: StartSessionOptions): Promise<SessionInfo> {
    const id = options.sessionId ?? `mock-${++this.sequence}`;
    const info: SessionInfo = {
      id,
      workspace: options.workspace,
      startedAt: new Date().toISOString(),
      status: 'idle',
    };
    this.sessions.set(id, info);
    return info;
  }

  async *sendMessage(
    sessionId: string,
    message: string,
  ): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === 'closed')
      throw new Error(`Unknown Pi session: ${sessionId}`);
    session.status = 'streaming';
    yield { type: 'status', status: 'started' };
    yield { type: 'text_delta', delta: `Mock Pi received: ${message}` };
    session.status = 'idle';
    yield { type: 'status', status: 'completed' };
  }

  async cancelTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.status = 'idle';
  }

  async listModels(): Promise<unknown[]> {
    return [{ provider: 'mock', id: 'mock-model', name: 'Mock model' }];
  }
  async switchModel(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId))
      throw new Error(`Unknown Pi session: ${sessionId}`);
  }
  async getVersion(): Promise<PiVersionInfo> {
    return version;
  }
  async healthCheck(): Promise<PiHealthStatus> {
    return {
      healthy: true,
      version,
      capabilities,
      activeSessions: this.sessions.size,
    };
  }
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) session.status = 'closed';
  }
}
