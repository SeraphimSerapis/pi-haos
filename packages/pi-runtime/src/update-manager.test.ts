import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { PiUpdateManager } from './update-manager.js';

async function packageWithHash(root: string, content: string): Promise<string> {
  const source = join(root, 'source');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'pi.js'), content);
  return createHash('sha256').update('pi.js').update(content).digest('hex');
}

describe('PiUpdateManager', () => {
  it('verifies, smoke-tests, activates, and rolls back versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-update-'));
    const first = await packageWithHash(root, 'one');
    const manager = new PiUpdateManager({
      root: join(root, 'data'),
      bundledVersion: '1.0.0',
      smokeTest: async (_path, version) => {
        if (version === '2.0.0') return;
      },
    });
    await manager.stage(join(root, 'source'), '1.0.0', first);
    await manager.activate('1.0.0');
    const second = await packageWithHash(root, 'two');
    await manager.stage(join(root, 'source'), '2.0.0', second);
    await manager.activate('2.0.0');
    expect((await manager.rollback()).active).toBe('1.0.0');
    await rm(root, { recursive: true, force: true });
  });

  it('rejects integrity mismatches and busy updates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-update-fail-'));
    const checksum = await packageWithHash(root, 'content');
    const busy = new PiUpdateManager({
      root: join(root, 'data'),
      bundledVersion: '1.0.0',
      isIdle: () => false,
    });
    await expect(
      busy.stage(join(root, 'source'), '1.0.0', checksum),
    ).rejects.toThrow('idle');
    const manager = new PiUpdateManager({
      root: join(root, 'data'),
      bundledVersion: '1.0.0',
    });
    await expect(
      manager.stage(join(root, 'source'), '1.0.0', '0'.repeat(64)),
    ).rejects.toThrow('integrity');
    await rm(root, { recursive: true, force: true });
  });
});
