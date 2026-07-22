import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HomeAssistantClient } from '@pi-ha/ha-client';
import {
  ToolBroker,
  ToolBrokerError,
  listStructuredTools,
} from './tool-broker.js';

function client(): HomeAssistantClient {
  return {
    getStates: vi.fn(async () => [{ entity_id: 'light.office', state: 'on' }]),
    getEntityRegistry: vi.fn(async () => []),
    getDeviceRegistry: vi.fn(async () => []),
    getAreaRegistry: vi.fn(async () => []),
    getServices: vi.fn(async () => ({})),
    getCoreInfo: vi.fn(async () => ({ version: '2026.7.0' })),
    getErrorLog: vi.fn(async () => 'ok'),
    renderTemplate: vi.fn(async (value: string) => value),
    checkConfig: vi.fn(async () => ({ result: 'valid' })),
  } as unknown as HomeAssistantClient;
}

describe('ToolBroker', () => {
  it('exposes only named structured tools and routes reads', async () => {
    const ha = client();
    const broker = new ToolBroker(ha, '/tmp/config');
    expect(listStructuredTools().map((tool) => tool.name)).toContain(
      'ha_get_states',
    );
    await expect(
      broker.call('ha_get_states', {}, { sessionId: 's1' }),
    ).resolves.toMatchObject({
      capability: 'read_runtime_state',
      result: [{ entity_id: 'light.office', state: 'on' }],
    });
    expect(ha.getStates).toHaveBeenCalledOnce();
  });

  it('fails closed for unknown or ask/deny policy decisions', async () => {
    const broker = new ToolBroker(client(), '/tmp/config', {
      read_runtime_state: 'ask',
    });
    await expect(
      broker.call('ha_get_states', {}, { sessionId: 's1' }),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      broker.call('not_a_tool', {}, { sessionId: 's1' }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('reads only regular files within the assigned workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-tool-workspace-'));
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', 'note.txt'), 'safe');
    const outside = await mkdtemp(join(tmpdir(), 'pi-tool-outside-'));
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    const broker = new ToolBroker(client(), '/tmp/config');
    await expect(
      broker.call(
        'workspace_read_file',
        { path: 'nested/note.txt' },
        { sessionId: 's1', workspace: root },
      ),
    ).resolves.toMatchObject({ result: 'safe' });
    await expect(
      broker.call(
        'workspace_read_file',
        { path: 'escape.txt' },
        { sessionId: 's1', workspace: root },
      ),
    ).rejects.toBeInstanceOf(ToolBrokerError);
  });
});
