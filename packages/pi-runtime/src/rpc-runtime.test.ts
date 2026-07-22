import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { RpcPiRuntime } from './rpc-runtime.js';

class FakeProcess extends PassThrough {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      const request = JSON.parse(chunk.toString()) as {
        id: string;
        type: string;
      };
      if (request.type === 'prompt') {
        setImmediate(() => {
          this.stdout.write(JSON.stringify({ type: 'agent_start' }) + '\n');
          this.stdout.write(
            JSON.stringify({
              type: 'message_update',
              assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
            }) + '\n',
          );
          this.stdout.write(JSON.stringify({ type: 'agent_end' }) + '\n');
          this.stdout.write(
            JSON.stringify({
              type: 'response',
              id: request.id,
              command: 'prompt',
              success: true,
            }) + '\n',
          );
        });
      } else if (request.type === 'get_available_models') {
        setImmediate(() =>
          this.stdout.write(
            JSON.stringify({
              type: 'response',
              id: request.id,
              command: request.type,
              success: true,
              data: { models: [{ id: 'mock' }] },
            }) + '\n',
          ),
        );
      } else if (request.type === 'abort') {
        setImmediate(() =>
          this.stdout.write(
            JSON.stringify({
              type: 'response',
              id: request.id,
              command: request.type,
              success: true,
            }) + '\n',
          ),
        );
      }
    });
  }

  kill(): boolean {
    return true;
  }
}

describe('RpcPiRuntime', () => {
  it('normalizes structured RPC streaming events and discovers models', async () => {
    let process: FakeProcess | undefined;
    const runtime = new RpcPiRuntime({
      piCommand: '/opt/pi',
      launcherPath: '/bin/sh',
      version: { version: '1.0.0', source: 'bundled', path: '/opt/pi' },
      spawnProcess: (() => {
        process = new FakeProcess();
        return process as never;
      }) as never,
      discoveryWorkspace: '/tmp/pi-discovery',
    });

    const session = await runtime.startSession({
      workspace: '/tmp/pi-session',
    });
    const events = [];
    for await (const event of runtime.sendMessage(session.id, 'hello'))
      events.push(event);
    expect(events).toEqual([
      { type: 'status', status: 'started' },
      { type: 'text_delta', delta: 'hello' },
      { type: 'status', status: 'completed' },
    ]);
    expect(await runtime.listModels()).toEqual([{ id: 'mock' }]);
    await runtime.closeSession(session.id);
    expect(process).toBeDefined();
  });
});
