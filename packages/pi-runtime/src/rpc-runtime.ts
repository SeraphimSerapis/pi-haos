import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AsyncQueue } from './queue.js';
import { assertSandboxLauncher, buildSandboxArgs } from './sandbox.js';
import type {
  AgentEvent,
  PiCapabilities,
  PiHealthStatus,
  PiRuntime,
  PiVersionInfo,
  RpcEvent,
  RpcResponse,
  SessionInfo,
  StartSessionOptions,
} from './types.js';

export interface RpcPiRuntimeOptions {
  piCommand: string;
  piArgs?: string[];
  launcherPath: string;
  version: PiVersionInfo;
  capabilities?: PiCapabilities;
  env?: NodeJS.ProcessEnv;
  maxLineBytes?: number;
  spawnProcess?: typeof spawn;
  discoveryWorkspace?: string;
  capabilityProbe?: () => Promise<PiCapabilities>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

class RpcSession {
  readonly info: SessionInfo;
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(event: RpcEvent) => void>();
  private readonly maxLineBytes: number;
  private closed = false;

  constructor(
    info: SessionInfo,
    process: ChildProcessWithoutNullStreams,
    maxLineBytes: number,
  ) {
    this.info = info;
    this.process = process;
    this.maxLineBytes = maxLineBytes;
    let stdoutBuffer = Buffer.alloc(0);
    process.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)]);
      let newline = stdoutBuffer.indexOf(0x0a);
      while (newline >= 0) {
        let line = stdoutBuffer.subarray(0, newline);
        if (line.at(-1) === 0x0d) line = line.subarray(0, line.length - 1);
        this.handleLine(line.toString('utf8'));
        stdoutBuffer = stdoutBuffer.subarray(newline + 1);
        newline = stdoutBuffer.indexOf(0x0a);
      }
      if (stdoutBuffer.byteLength > this.maxLineBytes)
        this.fail(new Error('Pi RPC line exceeded limit'));
    });
    process.stderr.on('data', (chunk: Buffer) => {
      if (chunk.byteLength > this.maxLineBytes)
        this.fail(new Error('Pi stderr line exceeded limit'));
    });
    process.on('error', (error) => this.fail(error));
    process.on('close', (code, signal) =>
      this.fail(
        new Error(`Pi exited (${code ?? 'null'}, ${signal ?? 'no signal'})`),
      ),
    );
  }

  private handleLine(line: string): void {
    if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes)
      return this.fail(new Error('Pi RPC line exceeded limit'));
    let message: RpcResponse | RpcEvent;
    try {
      message = JSON.parse(line) as RpcResponse | RpcEvent;
    } catch {
      return this.fail(new Error('Pi emitted malformed JSON'));
    }
    if (
      message.type === 'response' &&
      typeof (message as RpcResponse).id === 'string'
    ) {
      const pending = this.pending.get((message as RpcResponse).id as string);
      if (!pending) return;
      this.pending.delete((message as RpcResponse).id as string);
      const response = message as RpcResponse;
      if (response.success) pending.resolve(response.data);
      else
        pending.reject(
          new Error(response.error ?? `Pi command failed: ${response.command}`),
        );
    }
    for (const listener of this.listeners) listener(message as RpcEvent);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (this.info.status !== 'closed') this.info.status = 'crashed';
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async command(
    command: string,
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.closed) throw new Error('Pi session is closed');
    const id = randomUUID();
    const message = JSON.stringify({ type: command, id, ...payload });
    if (Buffer.byteLength(message, 'utf8') > this.maxLineBytes)
      throw new Error('Pi RPC request exceeded limit');
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${message}\n`, (error) => {
        if (error) reject(error);
      });
    });
  }

  stream(
    command: string,
    payload: Record<string, unknown>,
  ): AsyncQueue<AgentEvent> {
    const queue = new AsyncQueue<AgentEvent>();
    const listener = (event: RpcEvent) => {
      const normalized = normalizeEvent(event);
      if (normalized) queue.push(normalized);
      if (
        event.type === 'agent_end' ||
        (event.type === 'response' &&
          (event as unknown as RpcResponse).command === command)
      ) {
        this.listeners.delete(listener);
        queue.end();
      }
    };
    this.listeners.add(listener);
    void this.command(command, payload).catch((error: Error) => {
      this.listeners.delete(listener);
      queue.end(error);
    });
    return queue;
  }

  close(): void {
    this.closed = true;
    this.info.status = 'closed';
    this.process.kill('SIGTERM');
    for (const pending of this.pending.values())
      pending.reject(new Error('Pi session closed'));
    this.pending.clear();
  }
}

function normalizeEvent(event: RpcEvent): AgentEvent | undefined {
  if (event.type === 'message_update') {
    const nested = event.assistantMessageEvent as
      { type?: string; delta?: string } | undefined;
    if (nested?.type === 'text_delta' && typeof nested.delta === 'string')
      return { type: 'text_delta', delta: nested.delta };
    if (nested?.type === 'thinking_delta' && typeof nested.delta === 'string')
      return { type: 'thinking_delta', delta: nested.delta };
  }
  if (
    event.type === 'tool_execution_start' &&
    typeof event.toolName === 'string'
  ) {
    return typeof event.toolCallId === 'string'
      ? {
          type: 'tool_start',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        }
      : { type: 'tool_start', toolName: event.toolName };
  }
  if (event.type === 'tool_execution_end' && typeof event.toolName === 'string')
    return {
      type: 'tool_end',
      toolName: event.toolName,
      isError: event.isError === true,
      result: event.result,
    };
  if (event.type === 'agent_start')
    return { type: 'status', status: 'started' };
  if (event.type === 'agent_end')
    return { type: 'status', status: 'completed' };
  return undefined;
}

export class RpcPiRuntime implements PiRuntime {
  private readonly sessions = new Map<string, RpcSession>();
  private readonly options: Required<
    Pick<RpcPiRuntimeOptions, 'maxLineBytes'>
  > &
    RpcPiRuntimeOptions;

  constructor(options: RpcPiRuntimeOptions) {
    this.options = { maxLineBytes: 1024 * 1024, ...options };
  }

  async startSession(options: StartSessionOptions): Promise<SessionInfo> {
    await assertSandboxLauncher(this.options.launcherPath);
    const id = options.sessionId ?? randomUUID();
    const sandboxOptions = {
      launcherPath: this.options.launcherPath,
      workspace: options.workspace,
      command: this.options.piCommand,
      args: [
        ...(this.options.piArgs ?? [
          '--mode',
          'rpc',
          '--no-approve',
          '--no-tools',
        ]),
      ],
    };
    const args = buildSandboxArgs(
      options.brokerPort === undefined
        ? sandboxOptions
        : { ...sandboxOptions, brokerPort: options.brokerPort },
    );
    const env = {
      ...this.options.env,
      PATH: this.options.env?.PATH ?? process.env.PATH ?? '',
      PI_HOME: '/data/pi/home',
    };
    const child = (this.options.spawnProcess ?? spawn)(
      this.options.launcherPath,
      args,
      { cwd: options.workspace, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const info: SessionInfo = {
      id,
      workspace: options.workspace,
      startedAt: new Date().toISOString(),
      status: 'idle',
    };
    this.sessions.set(
      id,
      new RpcSession(info, child, this.options.maxLineBytes),
    );
    return info;
  }

  sendMessage(sessionId: string, message: string): AsyncIterable<AgentEvent> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Pi session: ${sessionId}`);
    session.info.status = 'streaming';
    const events = session.stream('prompt', { message });
    return (async function* () {
      try {
        yield* events;
      } finally {
        if (session.info.status === 'streaming') session.info.status = 'idle';
      }
    })();
  }

  async cancelTurn(sessionId: string): Promise<void> {
    await this.requireSession(sessionId).command('abort');
  }
  async listModels(): Promise<unknown[]> {
    const current = this.sessions.values().next().value as
      RpcSession | undefined;
    if (current) {
      const data = (await current.command('get_available_models')) as
        { models?: unknown[] } | undefined;
      return data?.models ?? [];
    }
    if (!this.options.discoveryWorkspace)
      throw new Error(
        'Model discovery requires an active Pi session or discovery workspace',
      );
    const info = await this.startSession({
      workspace: this.options.discoveryWorkspace,
    });
    try {
      const data = (await this.requireSession(info.id).command(
        'get_available_models',
      )) as { models?: unknown[] } | undefined;
      return data?.models ?? [];
    } finally {
      await this.closeSession(info.id);
    }
  }
  async switchModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<void> {
    await this.requireSession(sessionId).command('set_model', {
      provider,
      modelId,
    });
  }
  async getVersion(): Promise<PiVersionInfo> {
    return this.options.version;
  }
  async healthCheck(): Promise<PiHealthStatus> {
    const sessions = [...this.sessions.values()];
    const crashed = sessions.find(
      (session) => session.info.status === 'crashed',
    );
    const capabilities =
      this.options.capabilities ??
      (this.options.capabilityProbe
        ? await this.options.capabilityProbe()
        : null);
    return {
      healthy: !crashed,
      version: this.options.version,
      capabilities,
      activeSessions: sessions.filter(
        (session) => session.info.status !== 'closed',
      ).length,
      ...(crashed ? { error: `Pi session crashed: ${crashed.info.id}` } : {}),
    };
  }
  async closeSession(sessionId: string): Promise<void> {
    this.sessions.get(sessionId)?.close();
    this.sessions.delete(sessionId);
  }
  private requireSession(id: string): RpcSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown Pi session: ${id}`);
    return session;
  }
}
