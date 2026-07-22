import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelSettingsStore, defaultModelSettings } from './model-settings.js';

describe('ModelSettingsStore', () => {
  it('persists independent interactive and automation defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-model-settings-'));
    const store = new ModelSettingsStore(join(root, 'settings.json'));
    expect(await store.get()).toEqual(defaultModelSettings);
    await store.update({
      interactive: { provider: 'openai', modelId: 'gpt-4.1' },
      automation: { provider: 'local', modelId: 'llama3.2' },
    });
    const persisted = JSON.parse(
      await readFile(join(root, 'settings.json'), 'utf8'),
    );
    expect(persisted.automation).toEqual({
      provider: 'local',
      modelId: 'llama3.2',
    });
  });

  it('rejects malformed selections', async () => {
    const store = new ModelSettingsStore(
      join(
        await mkdtemp(join(tmpdir(), 'pi-model-settings-')),
        'settings.json',
      ),
    );
    await expect(
      store.update({ interactive: { provider: 'bad provider', modelId: 'x' } }),
    ).rejects.toThrow('interactive');
  });
});
