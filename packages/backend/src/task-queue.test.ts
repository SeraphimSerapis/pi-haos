import { describe, expect, it } from 'vitest';
import { TaskQueue, TaskQueueFullError } from './task-queue.js';

describe('TaskQueue', () => {
  it('runs queued work FIFO and tracks bounded occupancy', async () => {
    const queue = new TaskQueue(1, 1);
    const firstRelease = await queue.acquire();
    const second = queue.acquire();
    expect(queue.status()).toMatchObject({ active: 1, queued: 1 });
    await expect(queue.acquire()).rejects.toBeInstanceOf(TaskQueueFullError);
    firstRelease();
    const secondRelease = await second;
    expect(queue.status()).toMatchObject({ active: 1, queued: 0 });
    secondRelease();
    expect(queue.status()).toMatchObject({ active: 0, queued: 0 });
  });
});
