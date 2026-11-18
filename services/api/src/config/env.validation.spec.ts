import { environmentSchema } from './env.validation';

describe('environmentSchema', () => {
  it('requires a valid PostgreSQL connection string', () => {
    const result = environmentSchema.validate({ DATABASE_URL: 'not-a-url' });
    expect(result.error).toBeDefined();
  });

  it('applies safe development defaults', () => {
    const result = environmentSchema.validate({
      DATABASE_URL: 'postgresql://momentia:local@localhost:5432/momentia',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.NODE_ENV).toBe('development');
    expect(result.value.PORT).toBe(3000);
    expect(result.value.DATABASE_POOL_MAX).toBe(10);
    expect(result.value.DATABASE_SSL).toBe(false);
  });

  it('rejects unsupported runtime environments', () => {
    const result = environmentSchema.validate({
      NODE_ENV: 'production-ish',
      DATABASE_URL: 'postgresql://momentia:local@localhost:5432/momentia',
    });
    expect(result.error).toBeDefined();
  });
});
