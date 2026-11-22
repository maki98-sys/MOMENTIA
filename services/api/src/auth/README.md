# OIDC authentication implementation notes

## Implemented

- Provider-neutral OIDC JWT access-token verification using remote JWKS.
- Required issuer, audience, expiry and identity claims; RS256/ES256 algorithm allowlist and bounded clock tolerance.
- Configuration validation for issuer, audience and JWKS URI; local development can start without an identity provider, but protected requests fail closed with service-unavailable.
- Bearer guard resolves the external `issuer + subject` identity and attaches the canonical MOMENTIA user ID to the request.
- Transactional first-login provisioning into `users` and `auth_identities`, serialized by issuer/subject and verified-email advisory locks.
- Only verified email may provision an account. Matching email alone never links identities.
- Suspended, deletion-pending and otherwise inactive accounts are denied.
- MOMENTIA access/refresh session issuance, hashed refresh-token persistence, rotation, reuse detection and revocation.
- Authenticated identity listing, linking and unlinking using a fresh token proving control of the additional identity.

## Device and session management endpoints

All routes below derive the account ID from the verified identity/session, never from request input.

- `POST /auth/devices`: registers a device with required `deviceKey` (stable installation UUID), `platform` and optional `pushToken`. The server encrypts the raw push token; clients must send it over TLS and must not pre-encrypt it. Re-registering a device key is idempotent. Moving the key to another account revokes the prior account's sessions and pending push deliveries.
- Push tokens are currently supported only for iOS and Android. Web devices may register without a push token; web push delivery is not implemented.
- `GET /auth/devices`: lists active devices belonging to the authenticated account.
- `POST /auth/devices/:deviceId/heartbeat`: updates last-seen only for an active device owned by the caller.
- `DELETE /auth/devices/:deviceId`: revokes the owned device, linked MOMENTIA sessions and pending push deliveries in one transaction.
- `POST /auth/sessions`: exchanges a verified OIDC access token for a MOMENTIA session; optional `deviceId` must belong to the account.
- `POST /auth/sessions/refresh`: rotates the refresh token and detects reuse.
- `DELETE /auth/sessions/current`: revokes the current MOMENTIA session.
- `GET /auth/sessions`: lists up to 100 session metadata rows; refresh-token hashes are never returned.
- `DELETE /auth/sessions/:sessionId`: revokes one active session owned by the caller.
- `DELETE /auth/sessions`: revokes all active sessions belonging to the caller.
- `GET /auth/identities`, `POST /auth/identities/link` and `POST /auth/identities/unlink`: list and manage linked identities. Link/unlink require a MOMENTIA session and a fresh provider token proving control of the identity.

These endpoints revoke MOMENTIA sessions and device records. They do not revoke the identity provider's own access tokens; provider logout/revocation integration remains necessary.

## Not implemented yet

- Provider tenant/application registration, production credentials and provider-specific Android/iOS Authorization Code + PKCE client integration.
- Provider callback/deep-link validation and end-to-end tests against a real provider and production tenant.
- Account recovery and support-assisted identity recovery.
- Web Push provider integration and delivery receipts.
- A complete resource authorization matrix and exhaustive negative cross-account/cross-space tests. Authorization hardening is ongoing; see the open backend security audit and CI evidence.

## Integration sequence

1. Approve a concrete managed OIDC provider and supported login methods.
2. Register native Android/iOS clients and API audience; configure exact issuer, audience and JWKS URL in each environment.
3. Verify the provider's access-token format and claims. Do not assume ID tokens are API access tokens.
4. Implement provider-specific PKCE client integration and callback validation.
5. Integrate device registration using a stable installation UUID, MOMENTIA session issuance, refresh rotation and logout.
6. Complete account recovery, provider logout and production security review.
7. Complete the resource authorization matrix and cross-account/cross-space regression tests before launch.

## Operational requirements

Never log bearer tokens, authorization headers, raw refresh tokens or full provider claims. Store client credentials only in a managed secret store. Mobile refresh credentials must be stored in platform secure storage (iOS Keychain / Android Keystore), never in SQLite or ordinary preferences. Offline cache access does not grant server-side access: queued mutations must be re-authorized at synchronization time.
