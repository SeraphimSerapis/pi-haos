import { describe, expect, it } from 'vitest';
import { TransactionEngine, sha256, unifiedDiff } from './engine.js';
import type { ApplyPort } from './types.js';

function port(
  initial: Record<string, string>,
): ApplyPort & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    async read(path) {
      return files[path] ?? null;
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    async remove(path) {
      delete files[path];
    },
    async validate() {},
  };
}

describe('transaction engine', () => {
  it('hashes and creates reviewable diffs', () => {
    expect(sha256('hello')).toHaveLength(64);
    expect(unifiedDiff('automations.yaml', 'old', 'new')).toContain('-old');
  });
  it('detects live-file conflicts before writes', async () => {
    const backend = new TransactionEngine();
    const target = port({ 'automations.yaml': 'old' });
    const transaction = await backend.stage(
      'task-1',
      [{ path: 'automations.yaml', content: 'new' }],
      target,
    );
    const approved = backend.approve(transaction);
    target.files['automations.yaml'] = 'changed';
    await expect(backend.apply(approved, target)).resolves.toMatchObject({
      state: 'conflicted',
    });
    expect(target.files['automations.yaml']).toBe('changed');
  });
  it('rolls back when post-apply validation fails', async () => {
    const backend = new TransactionEngine();
    const target = port({ 'scripts.yaml': 'old' });
    let validations = 0;
    target.validate = async () => {
      validations += 1;
      if (validations === 2) throw new Error('invalid config');
    };
    const transaction = backend.approve(
      await backend.stage(
        'task-2',
        [{ path: 'scripts.yaml', content: 'new' }],
        target,
      ),
    );
    await expect(backend.apply(transaction, target)).resolves.toMatchObject({
      state: 'rolled_back',
    });
    expect(target.files['scripts.yaml']).toBe('old');
  });
});
