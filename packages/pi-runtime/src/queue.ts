export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;
  private failure: Error | undefined;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      if (error) waiter(Promise.reject(error) as never);
      else waiter({ done: true, value: undefined as never });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length)
      return { done: false, value: this.values.shift() as T };
    if (this.ended) {
      if (this.failure) throw this.failure;
      return { done: true, value: undefined as never };
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push((result) => {
        if (result instanceof Promise) result.catch(reject);
        else resolve(result);
      });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}
