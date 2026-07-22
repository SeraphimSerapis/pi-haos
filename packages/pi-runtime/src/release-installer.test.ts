import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiReleaseInstaller } from './release-installer.js';
import { PiUpdateManager } from './update-manager.js';

describe('PiReleaseInstaller', () => {
  it('verifies the archive and stages without activating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-installer-'));
    const archive = Buffer.from('fixture archive');
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    const manager = new PiUpdateManager({
      root: join(root, 'runtime'),
      bundledVersion: '0.81.1',
      smokeTest: async (directory) => {
        expect(await readFile(join(directory, 'pi.js'), 'utf8')).toBe('ok');
      },
    });
    const installer = new PiReleaseInstaller({
      updateManager: manager,
      fetchImpl: async () => new Response(archive),
      tempRoot: root,
      extractArchive: async (_archive, destination) => {
        await mkdir(join(destination, 'package'), { recursive: true });
        await writeFile(join(destination, 'package', 'pi.js'), 'ok');
      },
    });
    const status = await installer.install({
      packageName: 'pi-agent',
      version: '0.82.0',
      tarballUrl: 'https://registry.example.test/pi.tgz',
      integrity,
      description: null,
      registryUrl: 'https://registry.example.test/pi-agent',
    });
    expect(status.active).toBe('0.81.1');
    expect(status.installed).toContain('0.82.0');
  });

  it('rejects an integrity mismatch before extraction', async () => {
    const extractArchive = async () => {
      throw new Error('must not extract');
    };
    const installer = new PiReleaseInstaller({
      updateManager: new PiUpdateManager({
        root: await mkdtemp(join(tmpdir(), 'pi-installer-')),
        bundledVersion: '0.81.1',
      }),
      fetchImpl: async () => new Response('wrong'),
      extractArchive,
    });
    await expect(
      installer.install({
        packageName: 'pi-agent',
        version: '0.82.0',
        tarballUrl: 'https://registry.example.test/pi.tgz',
        integrity: 'sha512-YWJjZA==',
        description: null,
        registryUrl: 'https://registry.example.test/pi-agent',
      }),
    ).rejects.toThrow('integrity');
  });
});
