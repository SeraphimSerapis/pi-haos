import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from './task-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('TaskStore', () => {
  it('persists bounded task metadata and transitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-task-'));
    roots.push(root);
    const path = join(root, 'tasks.sqlite');
    const first = new TaskStore(path);
    const task = first.create({
      prompt: 'inspect',
      initiator: 'user',
      model: null,
      provider: null,
      piVersion: '0.81.1',
      skills: ['reader'],
    });
    expect(first.get(task.id)?.state).toBe('created');
    expect(first.transition(task.id, 'awaiting_review')?.state).toBe(
      'awaiting_review',
    );
    first.close();
    const reopened = new TaskStore(path);
    expect(reopened.list()[0]).toMatchObject({
      id: task.id,
      state: 'awaiting_review',
      skills: ['reader'],
    });
    reopened.close();
  });
});
