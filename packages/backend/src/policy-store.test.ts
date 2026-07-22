import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PolicyStore, defaultCapabilityPolicy } from './policy-store.js';

describe('PolicyStore', () => {
  it('starts with safe defaults and persists bounded updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-policy-'));
    const path = join(root, 'policy.json');
    const store = new PolicyStore(path);
    expect(store.get()).toEqual(defaultCapabilityPolicy);
    await store.replace({ read_runtime_state: 'deny', shell_access: 'allow' });
    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<
      string,
      string
    >;
    expect(persisted.read_runtime_state).toBe('deny');
    expect(persisted.shell_access).toBe('allow');
    expect(new PolicyStore(path).get().read_runtime_state).toBe('deny');
  });

  it('rejects unknown capabilities and decisions', async () => {
    const store = new PolicyStore(
      join(await mkdtemp(join(tmpdir(), 'pi-policy-')), 'policy.json'),
    );
    await expect(store.replace({ unknown: 'deny' })).rejects.toThrow(
      'Unknown capability',
    );
    await expect(store.replace({ shell_access: 'maybe' })).rejects.toThrow(
      'Invalid decision',
    );
  });
});
