import { describe, expect, it } from 'vitest';
import { MockPiRuntime } from './mock-runtime.js';

describe('MockPiRuntime', () => {
  it('provides deterministic isolated session events', async () => {
    const runtime = new MockPiRuntime();
    const session = await runtime.startSession({ workspace: '/tmp/session-a' });
    const events = [];
    for await (const event of runtime.sendMessage(session.id, 'hello'))
      events.push(event);
    expect(events).toEqual([
      { type: 'status', status: 'started' },
      { type: 'text_delta', delta: 'Mock Pi received: hello' },
      { type: 'status', status: 'completed' },
    ]);
  });
});
