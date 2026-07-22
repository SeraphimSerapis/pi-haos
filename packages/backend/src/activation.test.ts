import { describe, expect, it, vi } from 'vitest';
import {
  HomeAssistantActivationAdapter,
  inferActivationPlan,
} from './activation.js';

describe('activation plans', () => {
  it('requires restart for core-sensitive paths and reload for automations', () => {
    expect(
      inferActivationPlan({ files: [{ path: 'configuration.yaml' }] } as never)
        .action,
    ).toBe('restart');
    const reload = inferActivationPlan({
      files: [{ path: 'automations.yaml' }],
    } as never);
    expect(reload.action).toBe('reload');
    if (reload.action === 'reload') expect(reload.domain).toBe('automation');
  });

  it('fails closed when Core validation reports errors', async () => {
    const client = {
      checkConfig: vi.fn(async () => ({
        result: 'invalid',
        errors: 'bad config',
      })),
      callService: vi.fn(),
    } as never;
    const adapter = new HomeAssistantActivationAdapter(client);
    await expect(adapter.validateCore()).resolves.toEqual({
      valid: false,
      errors: ['bad config'],
    });
  });
});
