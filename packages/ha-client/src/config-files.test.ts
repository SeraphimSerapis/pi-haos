import { describe, expect, it } from 'vitest';
import { assertReadableConfigPath, redactSecrets } from './config-files.js';

describe('config file policy', () => {
  it('rejects traversal and protected paths', () => {
    expect(() =>
      assertReadableConfigPath('/config', '../secrets.yaml'),
    ).toThrow();
    expect(() => assertReadableConfigPath('/config', 'secrets.yaml')).toThrow();
    expect(() =>
      assertReadableConfigPath('/config', '.storage/core.config'),
    ).toThrow();
  });
  it('redacts common secret keys', () => {
    expect(redactSecrets('api_key: abc123\nname: test')).toContain(
      'api_key: "[REDACTED]"',
    );
  });
});
