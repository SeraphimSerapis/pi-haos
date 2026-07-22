import { describe, expect, it } from 'vitest';
import { KeyedMutex } from './concurrency.js';

describe('KeyedMutex', () => {
  it('serializes operations for one key while allowing different keys', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = mutex.run('session', async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
      return 1;
    });
    const second = mutex.run('session', async () => {
      events.push('second');
      return 2;
    });
    const other = mutex.run('other', async () => {
      events.push('other');
      return 3;
    });
    await Promise.resolve();
    expect(events).toEqual(['first-start', 'other']);
    releaseFirst();
    await expect(Promise.all([first, second, other])).resolves.toEqual([
      1, 2, 3,
    ]);
    expect(events).toEqual(['first-start', 'other', 'first-end', 'second']);
  });
});
