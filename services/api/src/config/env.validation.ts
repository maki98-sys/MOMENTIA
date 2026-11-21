import * as Joi from 'joi';

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(false),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(50).default(10),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  MEDIA_WORKER_TOKEN: Joi.string().min(32),
  AUDIO_REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }),
  OIDC_ISSUER: Joi.string().uri({ scheme: ['https'] }),
  OIDC_AUDIENCE: Joi.string().min(1),
  OIDC_JWKS_URI: Joi.string().uri({ scheme: ['https'] }),
}).and('OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URI')
  .messages({ 'object.and': 'OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI must be configured together.' });
