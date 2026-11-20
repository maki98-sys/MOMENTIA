# OIDC authentication implementation notes

## Current implementation boundary

The API now has a provider-neutral OIDC JWT access-token verification foundation:
- Configuration requires OIDC issuer, audience and JWKS URI as an all-or-none set.
- OIDC issuer and JWKS endpoints must use HTTPS.
- JWT verification checks signature through the configured remote JWKS, exact issuer, audience, expiry, required identity claims, clock tolerance and an explicit RS256/ES256 allowlist.
- The bearer guard attaches a minimal authenticated principal to the request.
- The guard is exported by AuthModule but is not installed globally and no product endpoint is exposed yet.
- The API can still start in local development without an identity provider configured; attempts to verify a token return service-unavailable rather than accepting an unverified identity.

## Not implemented yet

- Provider tenant/application registration and credentials.
- Provider-specific mobile SDK / Authorization Code + PKCE callback.
- Provider tenant/application registration and credentials.
- Provider-specific mobile SDK / Authorization Code + PKCE callback.
- MOMENTIA access/refresh session issuance, hashed refresh-token persistence, rotation, reuse detection and revocation.
- Device registration, logout, account-wide logout and session inventory.
- Authorization policies for users, spaces, albums, posts, audio rooms and media.
- End-to-end tests against a real provider.

## Integration sequence

1. Approve a concrete managed OIDC provider and supported login methods.
2. Register native Android/iOS clients and API audience; configure exact issuer, audience and JWKS URL in each environment.
3. Verify the provider's access-token format and claims. Do not assume ID tokens are API access tokens.
4. Add provider-specific PKCE client integration and callback validation.
5. Implement transactional external identity mapping and account lifecycle handling.
6. Implement MOMENTIA session issuance/rotation/revocation, storing only refresh-token hashes.
7. Add explicit resource authorization and negative cross-account/cross-space tests.
8. Complete threat model, privacy review and production configuration before enabling routes.

## Operational requirements

Never log bearer tokens, authorization headers, raw refresh tokens or full provider claims. Store client credentials only in a managed secret store. Mobile refresh credentials must be stored in platform secure storage (iOS Keychain / Android Keystore), never in SQLite or ordinary preferences. Offline cache access does not grant server-side access: queued mutations must be re-authorized at synchronization time.
