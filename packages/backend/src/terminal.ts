import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { buildSandboxArgs } from '@pi-ha/pi-runtime';

const MAX_INPUT_BYTES = 8192;
const MAX_OUTPUT_BYTES = 256 * 1024;

export interface TerminalSession {
  id: string;
  workspace: string;
  token: string;
}

export interface TerminalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(
    event: 'message' | 'close' | 'error',
    listener: (...args: any[]) => void,
  ): void;
}

interface TerminalOptions {
  launcherPath: string;
  piCommand: string;
  toolBrokerUrl: string;
  workspaceRoot: string;
  onStart(session: TerminalSession): void;
  onClose(id: string): void;
}

export class TerminalManager {
  private active: {
    session: TerminalSession;
    child: ChildProcessWithoutNullStreams;
  } | null = null;

  constructor(private readonly options: TerminalOptions) {}

  async attach(socket: TerminalSocket): Promise<void> {
    if (this.active) {
      socket.send('\r\nPi terminal is already in use.\r\n');
      socket.close(1013, 'Terminal busy');
      return;
    }
    const id = randomUUID();
    const workspace = `${this.options.workspaceRoot}/terminal-${id}`;
    const token = randomUUID();
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const piArgs = [
      '--no-builtin-tools',
      '--extension',
      '/app/pi-tools/ha-tools.ts',
    ];
    if (process.env.PI_DEFAULT_PROVIDER && process.env.PI_DEFAULT_MODEL) {
      piArgs.push(
        '--provider',
        process.env.PI_DEFAULT_PROVIDER,
        '--model',
        process.env.PI_DEFAULT_MODEL,
      );
    }
    const args = buildSandboxArgs({
      launcherPath: this.options.launcherPath,
      workspace,
      command: this.options.piCommand,
      args: piArgs,
    });
    const child = spawn(this.options.launcherPath, args, {
      cwd: workspace,
      env: {
        ...process.env,
        PI_HOME: '/data/pi/home',
        PI_HA_TOOL_TOKEN: token,
        PI_HA_TOOL_BROKER_URL: this.options.toolBrokerUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const session = { id, workspace, token };
    this.active = { session, child };
    this.options.onStart(session);
    let outputBytes = 0;
    const send = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        socket.send('\r\n[terminal output limit reached]\r\n');
        child.kill('SIGTERM');
        return;
      }
      socket.send(chunk.toString('utf8'));
    };
    child.stdout.on('data', send);
    child.stderr.on('data', send);
    child.on('error', (error) =>
      socket.send(`\r\n[Pi failed: ${error.message}]\r\n`),
    );
    child.on('close', (code, signal) => {
      if (this.active?.session.id === id) this.active = null;
      this.options.onClose(id);
      socket.send(`\r\n[Pi exited: ${code ?? signal ?? 'unknown'}]\r\n`);
      socket.close(1000, 'Pi exited');
    });
    socket.on('message', (data: unknown) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
        socket.send('\r\n[input too large]\r\n');
        return;
      }
      if (!child.stdin.destroyed) child.stdin.write(text);
    });
    socket.on('close', () => {
      if (this.active?.session.id === id) this.active = null;
      this.options.onClose(id);
      child.kill('SIGTERM');
    });
    socket.on('error', () => child.kill('SIGTERM'));
  }
}
