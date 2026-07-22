import { describe, expect, it } from 'vitest';
import { TransactionStore } from './transaction-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TransactionStore', () => {
  it('only exposes approved, validated transaction contents', () => {
    const store = new TransactionStore(':memory:');
    store.register({
      id: 'tx-1',
      state: 'approved',
      diffHash: 'abc',
      files: [
        {
          path: 'automations.yaml',
          content: '[]\n',
          originalHash: null,
          approved: true,
        },
      ],
      validation: { status: 'passed', errors: [] },
      createdAt: '2026-01-01T00:00:00Z',
      approvedAt: '2026-01-01T00:01:00Z',
    });
    expect(store.getApproved('tx-1')?.files[0]?.content).toBe('[]\n');
    expect(store.getApproved('missing')).toBeUndefined();
    store.close();
  });
  it('hides failed validation results', () => {
    const store = new TransactionStore(':memory:');
    store.register({
      id: 'tx-2',
      state: 'approved',
      diffHash: 'abc',
      files: [],
      validation: { status: 'failed', errors: ['invalid YAML'] },
      createdAt: '2026-01-01T00:00:00Z',
      approvedAt: '2026-01-01T00:01:00Z',
    });
    expect(store.getApproved('tx-2')).toBeUndefined();
    store.close();
  });

  it('persists review manifests across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-transactions-'));
    const path = join(root, 'transactions.sqlite');
    const first = new TransactionStore(path);
    first.registerReview({
      id: 'tx-review',
      taskId: 'task-1',
      state: 'awaiting_review',
      diffHash: 'hash',
      files: [],
      validation: { status: 'pending', errors: [] },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    first.close();
    const second = new TransactionStore(path);
    expect(second.get('tx-review')?.taskId).toBe('task-1');
    second.close();
    await rm(root, { recursive: true, force: true });
  });
});
