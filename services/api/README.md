# MOMENTIA API

NestJS modular monolith. PostgreSQL is authoritative for identity, permissions, memberships and durable product state.

## Requirements

- Node.js 22+
- PostgreSQL 15+ (CI verifies PostgreSQL 16)
- npm

## Local setup

1. Copy `.env.example` to `.env` and configure PostgreSQL.
2. Create the development database and apply migrations from the repository root:

   ```bash
   DATABASE_URL="postgresql://..." bash database/scripts/migrate.sh
   ```

3. Install and run:

   ```bash
   cd services/api
   npm install
   npm run start:dev
   ```

## Implemented API areas

- Health: `GET /api/v1/health/live`, `GET /api/v1/health/ready`.
- Profile: authenticated `GET/PUT /api/v1/me/profile`.
- Spaces: EVENT, CIRCLE and COUPLE; membership, roles and invitations.
- Event albums: create/list albums and manage references to ready media assets.
- Social: posts, feed, comments and reactions with audience checks.
- Media upload (initial transfer phase): authenticated `POST /api/v1/media/uploads` and `POST /api/v1/media/uploads/:uploadId/complete`.

## Private media configuration

The initial media transfer flow supports S3-compatible object storage. Configure `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together; `S3_REGION` defaults to `auto`. Keep the bucket private and grant the service identity only the minimum required object permissions. The API issues 10-minute presigned PUT URLs and verifies the stored object's size and declared Content-Type on completion.

This phase does not yet inspect magic bytes, recompute the file checksum, generate image variants, remove EXIF, publish timeline entries or serve authorized downloads. Uploaded assets remain pending and cannot be used as ready media. See `docs/11-media-upload.md`.

## Safety boundaries

- OIDC provider configuration is optional in local startup but must be configured before authenticated routes can be used.
- CORS is deny-by-default unless explicit origins are configured.
- PostgreSQL SSL can be enabled with `DATABASE_SSL=true`; production deployments must provide trusted TLS.
- Inject secrets through the deployment environment; never commit `.env`.
- No production deployment or real object-storage connection is implied by CI success.
