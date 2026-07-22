import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEventInput {
  action: string;
  initiator?: string | undefined;
  taskId?: string | undefined;
  transactionId?: string | undefined;
  sessionId?: string | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  piVersion?: string | undefined;
  decision?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  timestamp: string;
  details: Record<string, unknown>;
}

const SENSITIVE_KEY =
  /(token|secret|password|api[_-]?key|credential|authorization)/i;
const MAX_DETAIL_BYTES = 16 * 1024;
const MAX_STRING = 2048;

export class AuditStore {
  private readonly database: DatabaseSync;

  constructor(
    path = process.env.AUDIT_DATABASE ?? '/data/database/audit.sqlite',
    private readonly retention = 10_000,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_timestamp ON audit_events(timestamp DESC);
    `);
  }

  record(input: AuditEventInput): AuditEvent {
    const event: AuditEvent = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      details: redact(input.details ?? {}) as Record<string, unknown>,
    };
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload, 'utf8') > MAX_DETAIL_BYTES)
      throw new Error('Audit event exceeds the configured size limit');
    this.database
      .prepare(
        'INSERT INTO audit_events (id,timestamp,action,payload) VALUES (?,?,?,?)',
      )
      .run(event.id, event.timestamp, event.action, payload);
    this.database
      .prepare(
        'DELETE FROM audit_events WHERE id NOT IN (SELECT id FROM audit_events ORDER BY timestamp DESC LIMIT ?)',
      )
      .run(this.retention);
    return event;
  }

  list(limit = 100): AuditEvent[] {
    const bounded = Math.max(1, Math.min(limit, 100));
    return (
      this.database
        .prepare(
          'SELECT payload FROM audit_events ORDER BY timestamp DESC LIMIT ?',
        )
        .all(bounded) as Array<{ payload: string }>
    ).map((row) => JSON.parse(row.payload) as AuditEvent);
  }

  close(): void {
    this.database.close();
  }
}

function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    const clipped = value.slice(0, MAX_STRING);
    return clipped
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
      .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED]');
  }
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redact(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([childKey, childValue]) => [
          childKey,
          redact(childValue, childKey),
        ]),
    );
  return value;
}
