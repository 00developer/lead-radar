import { describe, expect, it } from 'vitest';
import { resolveCa } from '../src/lib/db/pg';
import { parseEnv } from '../src/lib/env';

describe('database certificate from the environment', () => {
  it('turns escaped line breaks into real ones', () => {
    const ca = resolveCa({ caPem: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----' });
    expect(ca).toBe('-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n');
  });
  it('keeps real line breaks as they are', () => {
    expect(resolveCa({ caPem: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----\n' })).toContain('\nABC\n');
  });
  it('uses the default trust store when nothing is set', () => {
    expect(resolveCa({})).toBeUndefined();
    expect(resolveCa({ caPem: '   ' })).toBeUndefined();
  });
  it('reads the pool size with a safe default', () => {
    expect(parseEnv({}).DATABASE_POOL_MAX).toBe(4);
    expect(parseEnv({ DATABASE_POOL_MAX: '1' }).DATABASE_POOL_MAX).toBe(1);
    expect(() => parseEnv({ DATABASE_POOL_MAX: '0' })).toThrow();
  });
});
