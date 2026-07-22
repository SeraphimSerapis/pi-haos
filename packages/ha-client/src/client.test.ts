import { describe, expect, it, vi } from 'vitest';
import { HomeAssistantClient } from './client.js';

describe('HomeAssistantClient', () => {
  it('adds the token and parses structured responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify([{ entity_id: 'light.office' }]), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new HomeAssistantClient({
      baseUrl: 'http://supervisor/core/',
      token: 'test-token',
      fetchImpl,
    });
    await expect(client.getStates()).resolves.toEqual([
      { entity_id: 'light.office' },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'http://supervisor/core/api/states',
    );
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer test-token');
  });
});
