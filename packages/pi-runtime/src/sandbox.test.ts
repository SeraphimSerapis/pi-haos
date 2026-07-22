import { describe, expect, it } from 'vitest';
import { buildSandboxArgs } from './sandbox.js';

describe('sandbox launch policy', () => {
  it('passes only an explicit workspace and broker port to the launcher', () => {
    expect(
      buildSandboxArgs({
        launcherPath: '/app/bin/pi-sandbox',
        workspace: '/data/sessions/a',
        brokerPort: 8765,
        command: '/opt/pi',
        args: ['--mode', 'rpc'],
      }),
    ).toEqual([
      '--workspace',
      '/data/sessions/a',
      '--broker-port',
      '8765',
      '--',
      '/opt/pi',
      '--mode',
      'rpc',
    ]);
  });

  it('rejects malformed workspace values', () => {
    expect(() =>
      buildSandboxArgs({
        launcherPath: '/app/bin/pi-sandbox',
        workspace: 'bad\0path',
        command: '/opt/pi',
        args: [],
      }),
    ).toThrow('workspace');
  });
});
