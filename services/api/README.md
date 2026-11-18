# MOMENTIA API

NestJS modular monolith foundation. This service is the server-side system of record; PostgreSQL remains authoritative for identity, permissions and durable state.

## Requirements

- Node.js 22+
- PostgreSQL 15+ (CI currently verifies against PostgreSQL 16)
- npm

## Local setup

1. Copy `.env.example` to `.env` and set a local PostgreSQL connection string.
2. Create the development database and apply the repository migrations from the root:

   ```bash
   DATABASE_URL="postgresql://..." bash database/scripts/migrate.sh
   ```

3. Install and run the API:

   ```bash
   cd services/api
   npm install
   npm run start:dev
   ```

## Initial endpoints

- `GET /api/v1/health/live`: process liveness; does not depend on PostgreSQL.
- `GET /api/v1/health/ready`: readiness; returns 503 if PostgreSQL cannot answer `SELECT 1`.

## Safety boundaries

- No authentication or product endpoints are exposed yet.
- CORS is deny-by-default unless explicit origins are configured.
- PostgreSQL SSL can be enabled with `DATABASE_SSL=true`; production deployments must provide a trusted TLS configuration.
- Secrets must be injected by the deployment environment; never commit `.env`.
- Do not add retention jobs until market-specific legal approval is recorded.
- Add each domain module with authorization tests before exposing its routes.
