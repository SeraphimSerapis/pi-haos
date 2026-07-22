import { describe, expect, it } from 'vitest';
import { detectCapabilities } from './capabilities.js';

describe('Pi capability detection', () => {
  it('enables only observed RPC features', () => {
    expect(
      detectCapabilities({
        rpcProtocolVersion: '1',
        commands: ['set_model', 'abort'],
        eventTypes: ['message_update'],
      }),
    ).toMatchObject({
      rpcProtocolVersion: '1',
      supportsModelSwitching: true,
      supportsCancellation: true,
      supportsToolWhitelisting: false,
      supportsStructuredEvents: true,
    });
  });
});
