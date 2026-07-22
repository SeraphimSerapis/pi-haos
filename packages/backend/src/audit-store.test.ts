import { describe, expect, it } from 'vitest';
import { AuditStore } from './audit-store.js';

describe('AuditStore', () => {
  it('redacts credentials and retains bounded history', () => {
    const store = new AuditStore(':memory:', 2);
    store.record({
      action: 'provider.save',
      details: {
        apiKey: 'super-secret',
        authorization: 'Bearer abc123',
        nested: { password: 'pw' },
      },
    });
    store.record({ action: 'task.create', details: { prompt: 'hello' } });
    store.record({ action: 'task.run', details: { prompt: 'third' } });
    const events = store.list();
    expect(events).toHaveLength(2);
    const providerEvent = events.find(
      (event) => event.action === 'provider.save',
    );
    expect(providerEvent?.details).toMatchObject({
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      nested: { password: '[REDACTED]' },
    });
    store.close();
  });
});
