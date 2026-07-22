import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelCatalog } from './model-catalog.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('ModelCatalog', () => {
  it('persists providers but never returns API keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-ha-models-'));
    temporaryDirectories.push(directory);
    const catalog = new ModelCatalog(join(directory, 'models.json'));
    await expect(
      catalog.upsert({
        id: 'openai',
        name: 'OpenAI',
        kind: 'openai',
        endpoint: 'https://api.openai.com/v1',
        models: ['gpt-4.1'],
        apiKey: 'secret',
      }),
    ).resolves.toMatchObject({ id: 'openai', hasApiKey: true });
    const publicProviders = await catalog.list();
    expect(publicProviders[0]).not.toHaveProperty('apiKey');
    expect(await readFile(join(directory, 'models.json'), 'utf8')).toContain(
      'secret',
    );
  });

  it('retains an existing key when an update omits it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-ha-models-'));
    temporaryDirectories.push(directory);
    const catalog = new ModelCatalog(join(directory, 'models.json'));
    await catalog.upsert({
      id: 'local',
      name: 'Local',
      kind: 'local',
      endpoint: 'http://localhost:4000/v1',
      models: ['demo'],
      apiKey: 'secret',
    });
    await catalog.upsert({
      id: 'local',
      name: 'Local 2',
      kind: 'local',
      endpoint: 'http://localhost:4000/v1',
      models: ['demo-2'],
    });
    expect((await catalog.get('local'))?.apiKey).toBe('secret');
  });
});
