import { describe, expect, it } from 'vitest';
import { validateYamlTransaction } from './transaction-validation.js';

const base = {
  id: 'tx-1',
  taskId: 'task-1',
  state: 'awaiting_review' as const,
  diffHash: 'hash',
  files: [],
  validation: { status: 'pending' as const, errors: [] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('transaction validation', () => {
  it('passes valid YAML and reports syntax errors', () => {
    expect(
      validateYamlTransaction({
        ...base,
        files: [
          {
            path: 'automations.yaml',
            content: '- alias: ok\n',
            originalHash: null,
            approved: false,
          },
        ],
      }).validation.status,
    ).toBe('passed');
    const invalid = validateYamlTransaction({
      ...base,
      files: [
        {
          path: 'automations.yaml',
          content: 'bad: [\n',
          originalHash: null,
          approved: false,
        },
      ],
    });
    expect(invalid.validation.status).toBe('failed');
    expect(invalid.validation.errors[0]).toContain('automations.yaml');
  });
});
