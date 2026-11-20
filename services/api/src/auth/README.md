# OIDC authentication implementation notes

## Implemented

- Provider-neutral OIDC JWT access-token verification using remote JWKS.
- Required issuer, audience, expiry and identity claims; RS256/ES256 algorithm allowlist and bounded clock tolerance.
- Configuration validation for issuer, audience and JWKS URI; local development can start without an identity provider, but protected requests fail closed with service-unavailable.
- Bearer guard resolves the external `issuer + subject` identity and attaches the canonical MOMENTIA user ID to the request.
- Transactional first-login provisioning into `users` and `auth_identities`, serialized with an advisory transaction lock.
- Only verified email may provision an account. Matching email alone never links identities; existing accounts require a future authenticated linking flow.
- Suspended or otherwise inactive accounts are denied.

## Not implemented yet

- Provider tenant/application registration and credentials.
- Provider-specific Android/iOS Authorization Code + PKCE client integration and callback validation.
- MOMENTIA access/refresh session issuance, hashed refresh-token persistence, rotation, reuse detection and revocation.
- Device registration, device/session inventory, logout and account-wide logout.
- Account recovery and authenticated identity-linking flow.
- End-to-end tests against a real provider and production tenant.
- Complete resource authorization matrix for every user, space, album, post, audio room and media operation.

## Integration sequence

1. Approve a concrete managed OIDC provider and supported login methods.
2. Register native Android/iOS clients and API audience; configure exact issuer, audience and JWKS URL in each environment.
3. Verify the provider's access-token format and claims. Do not assume ID tokens are API access tokens.
4. Add provider-specific PKCE client integration and callback validation.
5. Implement MOMENTIA session issuance/rotation/revocation, storing only refresh-token hashes.
6. Implement device registration, logout, recovery and safe account linking.
7. Add explicit resource authorization and negative cross-account/cross-space tests.
8. Complete threat model, privacy review and production configuration before launch.

## Operational requirements

Never log bearer tokens, authorization headers, raw refresh tokens or full provider claims. Store client credentials only in a managed secret store. Mobile refresh credentials must be stored in platform secure storage (iOS Keychain / Android Keystore), never in SQLite or ordinary preferences. Offline cache access does not grant server-side access: queued mutations must be re-authorized at synchronization time.
