import * as Joi from 'joi';

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(false),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(50).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).max(180000).default(60000),
  DATABASE_QUERY_TIMEOUT_MS: Joi.number().integer().min(1000).max(240000).default(65000),
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000).default(30000),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  MOMENTIA_MODERATOR_USER_IDS: Joi.string().allow('').default('').custom((value, helpers) => {
    const ids = value.split(',').map((entry: string) => entry.trim()).filter(Boolean);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ids.every((id: string) => uuid.test(id)) ? value : helpers.error('any.invalid');
  }),
  MEDIA_WORKER_TOKEN: Joi.string().min(32),
  ACCOUNT_DELETION_WORKER_TOKEN: Joi.string().min(32),
  AUTH_SESSION_WORKER_TOKEN: Joi.string().min(32),
  MEDIA_STORAGE_PROVIDER: Joi.string().valid('local','s3').default('local'),
  MEDIA_S3_BUCKET: Joi.when('MEDIA_STORAGE_PROVIDER',{is:'s3',then:Joi.string().min(3).required(),otherwise:Joi.string().allow('')}),
  MEDIA_S3_REGION: Joi.string().min(1).default('us-east-1'),
  MEDIA_S3_ENDPOINT: Joi.string().uri({scheme:['http','https']}).allow(''),
  MEDIA_S3_ACCESS_KEY_ID: Joi.string().min(1).allow(''),
  MEDIA_S3_SECRET_ACCESS_KEY: Joi.string().min(1).allow(''),
  MEDIA_S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true').falsy('false').default(false),
  NOTIFICATION_WORKER_TOKEN: Joi.string().min(32),
  EVENTS_WORKER_TOKEN: Joi.string().min(32),
  AUDIO_WORKER_TOKEN: Joi.string().min(32),
  BILLING_WORKER_TOKEN: Joi.string().min(32),
  PUSH_TOKEN_ENCRYPTION_KEY: Joi.string().base64().custom((value, helpers) => Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid')),
  AUDIO_REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }),
  OIDC_ISSUER: Joi.string().uri({ scheme: ['https'] }),
  OIDC_AUDIENCE: Joi.string().min(1),
  OIDC_JWKS_URI: Joi.string().uri({ scheme: ['https'] }),
  MOMENTIA_SESSION_SECRET: Joi.string().min(32).required(),
}).and('OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI')
  .and('MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY')
  .messages({ 'object.and': 'OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI must be configured together.' });
