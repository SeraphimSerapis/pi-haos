import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillsManager } from './manager.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const manifest = {
  id: 'automation-author',
  name: 'Automation Author',
  version: '1.0.0',
  description: 'Creates automations.',
  enabled: true,
  permissions: ['read_config'],
  compatibility: {},
};

describe('SkillsManager', () => {
  it('validates and persists user skills outside /config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-skills-'));
    roots.push(root);
    const manager = new SkillsManager(root);
    await manager.save(manifest, '# Instructions');
    await expect(manager.list()).resolves.toHaveLength(1);
    await expect(
      readFile(join(root, 'user', manifest.id, 'manifest.yaml'), 'utf8'),
    ).resolves.toContain('id: automation-author');
  });
  it('protects bundled skills from deletion and disabling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-skills-'));
    roots.push(root);
    const manager = new SkillsManager(root);
    await manager.save(manifest, '# Instructions', 'user');
    await expect(manager.remove('bundled', manifest.id)).rejects.toThrow(
      'Bundled',
    );
  });
  it('rejects malformed manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-skills-'));
    roots.push(root);
    const manager = new SkillsManager(root);
    await expect(
      manager.save({ ...manifest, id: 'Not Valid' }, '# Instructions'),
    ).rejects.toThrow('lowercase');
  });
});
