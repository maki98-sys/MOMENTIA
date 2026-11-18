import { environmentSchema } from './env.validation';

const database = 'postgresql://momentia:local@localhost:5432/momentia';

describe('environmentSchema', () => {
  it('requires a valid PostgreSQL connection string', () => {
    expect(environmentSchema.validate({ DATABASE_URL: 'not-a-url' }).error).toBeDefined();
  });
  it('applies safe development defaults', () => {
    const result = environmentSchema.validate({ DATABASE_URL: database });
    expect(result.error).toBeUndefined();
    expect(result.value.NODE_ENV).toBe('development');
    expect(result.value.PORT).toBe(3000);
    expect(result.value.DATABASE_POOL_MAX).toBe(10);
    expect(result.value.DATABASE_SSL).toBe(false);
  });
  it('rejects unsupported runtime environments', () => {
    expect(environmentSchema.validate({ NODE_ENV: 'production-ish', DATABASE_URL: database }).error).toBeDefined();
  });
  it('requires OIDC settings to be supplied as a complete set', () => {
    expect(environmentSchema.validate({ DATABASE_URL: database, OIDC_ISSUER: 'https://id.example.test/' }).error).toBeDefined();
  });
  it('accepts a complete OIDC configuration', () => {
    const result = environmentSchema.validate({
      DATABASE_URL: database,
      OIDC_ISSUER: 'https://id.example.test/',
      OIDC_AUDIENCE: 'momentia-api',
      OIDC_JWKS_URI: 'https://id.example.test/.well-known/jwks.json',
    });
    expect(result.error).toBeUndefined();
  });
});
