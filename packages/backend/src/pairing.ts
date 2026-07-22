import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

interface PairingState {
  pairingCode: string;
  tokenHash: string | null;
  createdAt: string;
}

export interface PairingStatus {
  paired: boolean;
  pairingCode: string | null;
}

export class PairingManager {
  private state: PairingState | null = null;

  constructor(
    private readonly filePath = `${process.env.DATA_DIR ?? '/data'}/pairing.json`,
  ) {}

  async status(): Promise<PairingStatus> {
    await this.load();
    return {
      paired: this.state?.tokenHash !== null,
      pairingCode: this.state?.tokenHash
        ? null
        : (this.state?.pairingCode ?? null),
    };
  }

  async exchange(pairingCode: string): Promise<string> {
    await this.load();
    if (
      !this.state ||
      !constantTimeEqual(this.state.pairingCode, pairingCode) ||
      this.state.tokenHash
    )
      throw new Error('Invalid or already-used pairing code');
    const token = randomBytes(32).toString('base64url');
    this.state = { ...this.state, pairingCode: '', tokenHash: digest(token) };
    await this.persist();
    return token;
  }

  async authenticate(token: string): Promise<boolean> {
    await this.load();
    return Boolean(
      this.state?.tokenHash &&
      constantTimeEqual(this.state.tokenHash, digest(token)),
    );
  }

  private async load(): Promise<void> {
    if (this.state) return;
    try {
      this.state = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as PairingState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = {
        pairingCode: formatCode(randomBytes(18).toString('hex')),
        tokenHash: null,
        createdAt: new Date().toISOString(),
      };
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function formatCode(value: string): string {
  return value.match(/.{1,6}/g)?.join('-') ?? value;
}
