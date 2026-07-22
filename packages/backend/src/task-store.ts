import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  taskRecordSchema,
  type TaskRecord,
  type TaskState,
} from '@pi-ha/shared';

type TaskRow = {
  id: string;
  prompt: string;
  initiator: string;
  model: string | null;
  provider: string | null;
  pi_version: string | null;
  skills: string;
  state: string;
  transaction_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export class TaskStore {
  private readonly database: DatabaseSync;

  constructor(
    path = process.env.TASK_DATABASE ?? '/data/database/tasks.sqlite',
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        initiator TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        pi_version TEXT,
        skills TEXT NOT NULL,
        state TEXT NOT NULL,
        transaction_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  create(
    input: Pick<
      TaskRecord,
      'prompt' | 'initiator' | 'model' | 'provider' | 'piVersion' | 'skills'
    >,
  ): TaskRecord {
    const now = new Date().toISOString();
    const task = taskRecordSchema.parse({
      ...input,
      id: randomUUID(),
      state: 'created',
      transactionId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    this.database
      .prepare(
        `INSERT INTO tasks (id,prompt,initiator,model,provider,pi_version,skills,state,transaction_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        task.id,
        task.prompt,
        task.initiator,
        task.model,
        task.provider,
        task.piVersion,
        JSON.stringify(task.skills),
        task.state,
        task.transactionId,
        task.error,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  get(id: string): TaskRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  list(): TaskRecord[] {
    return (
      this.database
        .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100')
        .all() as TaskRow[]
    ).map((row) => this.fromRow(row));
  }

  transition(
    id: string,
    state: TaskState,
    extra: { transactionId?: string | null; error?: string | null } = {},
  ): TaskRecord | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        'UPDATE tasks SET state = ?, transaction_id = ?, error = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        state,
        extra.transactionId === undefined
          ? current.transactionId
          : extra.transactionId,
        extra.error === undefined ? current.error : extra.error,
        updatedAt,
        id,
      );
    return this.get(id);
  }

  close(): void {
    this.database.close();
  }

  private fromRow(row: TaskRow): TaskRecord {
    return taskRecordSchema.parse({
      id: row.id,
      prompt: row.prompt,
      initiator: row.initiator,
      model: row.model,
      provider: row.provider,
      piVersion: row.pi_version,
      skills: JSON.parse(row.skills),
      state: row.state,
      transactionId: row.transaction_id,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
