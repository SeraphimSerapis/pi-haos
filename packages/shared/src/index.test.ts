import { describe, expect, it } from 'vitest';
import { appStatusSchema, taskStateSchema } from './index.js';

describe('shared contracts', () => {
  it('accepts the safe initial status', () => {
    expect(
      appStatusSchema.parse({
        status: 'ok',
        appVersion: '0.1.0',
        piVersion: null,
        homeAssistantMount: 'read-only',
        integration: 'not-installed',
        timestamp: new Date().toISOString(),
      }).homeAssistantMount,
    ).toBe('read-only');
  });

  it('contains terminal and failure task states', () => {
    expect(taskStateSchema.options).toContain('rolled_back');
    expect(taskStateSchema.options).toContain('completed');
  });
});
