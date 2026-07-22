export class TaskQueueFullError extends Error {
  constructor() {
    super('Task queue is full');
    this.name = 'TaskQueueFullError';
  }
}

type Waiter = { resolve: (release: () => void) => void };

/** Bounded FIFO queue for mutation-capable Pi task executions. */
export class TaskQueue {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly maxConcurrent = 1,
    private readonly maxQueued = 20,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)
      throw new Error('maxConcurrent must be a positive integer');
    if (!Number.isInteger(maxQueued) || maxQueued < 0)
      throw new Error('maxQueued must be a non-negative integer');
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return this.releaseFactory();
    }
    if (this.waiters.length >= this.maxQueued) throw new TaskQueueFullError();
    return new Promise((resolve) => this.waiters.push({ resolve }));
  }

  status(): {
    active: number;
    queued: number;
    maxConcurrent: number;
    maxQueued: number;
  } {
    return {
      active: this.active,
      queued: this.waiters.length,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
    };
  }

  private releaseFactory(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const waiter = this.waiters.shift();
      if (waiter) {
        this.active += 1;
        waiter.resolve(this.releaseFactory());
      }
    };
  }
}
