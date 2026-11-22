import { environmentSchema } from './env.validation';

const database = 'postgresql://momentia:local@localhost:5432/momentia';

describe('environmentSchema', () => {
  it('requires a valid PostgreSQL connection string', () => {
    expect(environmentSchema.validate({ DATABASE_URL: 'not-a-url' }).error).toBeDefined();
  });

  it('applies safe development defaults', () => {
    const result = environmentSchema.validate({ DATABASE_URL: database, MOMENTIA_SESSION_SECRET: 's'.repeat(32) });
    expect(result.error).toBeUndefined();
    expect(result.value.NODE_ENV).toBe('development');
    expect(result.value.PORT).toBe(3000);
    expect(result.value.DATABASE_POOL_MAX).toBe(10);
    expect(result.value.DATABASE_SSL).toBe(false);
    expect(result.value.MOMENTIA_SESSION_SECRET).toBe('s'.repeat(32));
  });

  it('applies bounded defaults and rejects unsafe media staging concurrency', () => {
    const base = {
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
    };
    const defaults = environmentSchema.validate(base);
    expect(defaults.error).toBeUndefined();
    expect(defaults.value.MEDIA_UPLOAD_STAGING_MAX_CONCURRENT).toBe(4);
    expect(defaults.value.MEDIA_UPLOAD_ASSEMBLY_MAX_CONCURRENT).toBe(2);
    expect(environmentSchema.validate({ ...base, MEDIA_UPLOAD_STAGING_MAX_CONCURRENT: 33 }).error).toBeDefined();
    expect(environmentSchema.validate({ ...base, MEDIA_UPLOAD_ASSEMBLY_MAX_CONCURRENT: 0 }).error).toBeDefined();
  });

  it('requires a strong session secret', () => {
    expect(environmentSchema.validate({ DATABASE_URL: database }).error).toBeDefined();
    expect(environmentSchema.validate({ DATABASE_URL: database, MOMENTIA_SESSION_SECRET: 'short' }).error).toBeDefined();
  });

  it('rejects unsupported runtime environments', () => {
    expect(environmentSchema.validate({ NODE_ENV: 'production-ish', DATABASE_URL: database }).error).toBeDefined();
  });

  it('requires OIDC settings to be supplied as a complete set', () => {
    expect(environmentSchema.validate({
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
      OIDC_ISSUER: 'https://id.example.test/',
    }).error).toBeDefined();
  });

  it('rejects an HTTP JWKS endpoint', () => {
    const result = environmentSchema.validate({
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
      OIDC_ISSUER: 'https://id.example.test/',
      OIDC_AUDIENCE: 'momentia-api',
      OIDC_JWKS_URI: 'http://id.example.test/.well-known/jwks.json',
    });
    expect(result.error).toBeDefined();
  });

  it('accepts a complete OIDC configuration', () => {
    const result = environmentSchema.validate({
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
      OIDC_ISSUER: 'https://id.example.test/',
      OIDC_AUDIENCE: 'momentia-api',
      OIDC_JWKS_URI: 'https://id.example.test/.well-known/jwks.json',
    });
    expect(result.error).toBeUndefined();
  });

  it('requires every internal worker secret and push-token encryption key in production', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
      MEDIA_WORKER_TOKEN: 'm'.repeat(32),
      ACCOUNT_DELETION_WORKER_TOKEN: 'd'.repeat(32),
      AUTH_SESSION_WORKER_TOKEN: 'a'.repeat(32),
      NOTIFICATION_WORKER_TOKEN: 'n'.repeat(32),
      EVENTS_WORKER_TOKEN: 'e'.repeat(32),
      AUDIO_WORKER_TOKEN: 'u'.repeat(32),
      BILLING_WORKER_TOKEN: 'b'.repeat(32),
      PUSH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    };
    expect(environmentSchema.validate(base).error).toBeUndefined();

    for (const key of [
      'MEDIA_WORKER_TOKEN',
      'ACCOUNT_DELETION_WORKER_TOKEN',
      'AUTH_SESSION_WORKER_TOKEN',
      'NOTIFICATION_WORKER_TOKEN',
      'EVENTS_WORKER_TOKEN',
      'AUDIO_WORKER_TOKEN',
      'BILLING_WORKER_TOKEN',
      'PUSH_TOKEN_ENCRYPTION_KEY',
    ]) {
      const incomplete = { ...base };
      delete (incomplete as Record<string, unknown>)[key];
      expect(environmentSchema.validate(incomplete).error).toBeDefined();
    }
  });

  it('rejects a weak media worker token when supplied', () => {
    const result = environmentSchema.validate({
      DATABASE_URL: database,
      MOMENTIA_SESSION_SECRET: 's'.repeat(32),
      MEDIA_WORKER_TOKEN: 'short',
    });
    expect(result.error).toBeDefined();
  });
});
