import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PiUpdateSettingsStore,
  defaultPiUpdateSettings,
} from './update-settings.js';

describe('PiUpdateSettingsStore', () => {
  it('persists channel and release metadata safely', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-update-settings-'));
    const store = new PiUpdateSettingsStore(join(root, 'settings.json'));
    expect(store.get()).toEqual(defaultPiUpdateSettings);
    await store.update({ enabled: true, channel: 'stable' });
    await store.recordCheck({
      latest: '0.82.0',
      changelog: 'Security fixes',
      compatibility: 'compatible',
    });
    const persisted = JSON.parse(
      await readFile(join(root, 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      enabled: true,
      channel: 'stable',
      latest: '0.82.0',
      compatibility: 'compatible',
    });
  });

  it('rejects invalid settings and release metadata', async () => {
    const store = new PiUpdateSettingsStore(
      join(
        await mkdtemp(join(tmpdir(), 'pi-update-settings-')),
        'settings.json',
      ),
    );
    await expect(store.update({ channel: 'beta' as never })).rejects.toThrow(
      'channel',
    );
    await expect(store.recordCheck({ latest: 'latest' })).rejects.toThrow(
      'version',
    );
  });
});
