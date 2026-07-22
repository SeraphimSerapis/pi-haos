import { describe, expect, it } from 'vitest';
import { TransactionStore } from './transaction-store.js';

describe('TransactionStore', () => {
  it('only exposes approved, validated transaction contents', () => {
    const store = new TransactionStore();
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
  });
  it('hides failed validation results', () => {
    const store = new TransactionStore();
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
  });
});
