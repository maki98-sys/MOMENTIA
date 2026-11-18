# ADR-001 — Identity and authentication strategy

- **Status:** proposed; awaiting product-owner approval before implementation
- **Date:** 2026-11-18
- **Scope:** MOMENTIA mobile clients (iOS/Android), guest web, NestJS API
- **Related schema:** `users`, `auth_identities`, `auth_sessions`, `devices`

## Context

MOMENTIA must support private spaces (EVENT, COUPLE and CIRCLE), personal profiles, social relationships, media permissions and offline work. The API must establish a trustworthy user identity before any private resource is read or changed.

The current PostgreSQL model deliberately separates:
- `users`: canonical MOMENTIA account and lifecycle state.
- `auth_identities`: external identity provider and provider subject.
- `auth_sessions`: revocable application sessions; only refresh-token hashes are stored.
- `devices`: registered client devices and push-token metadata.

There is no password hash column. The implementation must not silently add password storage or invent an authentication provider.

## Options considered

### A. Managed OpenID Connect (OIDC) identity provider — recommended

Use a standards-based OIDC provider for sign-in and identity proof. Mobile clients use Authorization Code Flow with PKCE. The API validates access tokens using issuer metadata/JWKS, audience, signature, expiry and allowed algorithms. MOMENTIA maps the stable provider + subject pair to `auth_identities` and creates/updates the canonical `users` record.

Advantages:
- Password handling, credential recovery and high-risk authentication operations remain with a specialist provider.
- Standard protocol and provider adapter reduce lock-in.
- Works with native mobile clients and web clients.
- No password hashes or raw refresh tokens are stored by MOMENTIA.

Trade-offs:
- Requires choosing, configuring and paying for a provider when applicable.
- Provider outage and account-linking behavior must be handled.
- Email/phone verification claims must be checked explicitly; a supplied email alone is not proof of account ownership.

### B. Self-hosted identity service

Operate an OIDC-compatible identity server. This preserves the protocol boundary but adds patching, availability, backups, abuse prevention, recovery and security operations to the MOMENTIA team.

### C. First-party email/phone and password authentication

Build credential enrollment, secure password hashing, verification, reset, MFA, abuse controls and incident response directly into MOMENTIA. This requires an explicit schema migration and a separate security review. It is not the default recommendation for the first implementation.

## Proposed protocol and session model

1. The client starts OIDC Authorization Code Flow with PKCE using the system browser / supported native SDK.
2. The client receives the provider authorization result and exchanges it according to the provider's supported native flow.
3. The API validates the provider-issued token using a pinned expected issuer and audience, JWKS signature validation, expiry, not-before and allowed algorithm checks. Never accept an arbitrary issuer or decode-only JWT validation.
4. The API resolves the provider + subject pair in `auth_identities`. If absent, account creation/linking follows an explicit verified-claim policy and a database transaction; do not merge accounts based only on matching unverified email.
5. MOMENTIA issues its own short-lived access token and an opaque high-entropy refresh token. Only a cryptographic hash of the refresh token is persisted in `auth_sessions`.
6. Refresh rotates the token: revoke/replace the prior session secret atomically, detect reuse, and revoke the session family on confirmed reuse.
7. Logout revokes the current session. Account-wide logout revokes all active sessions. Device revocation invalidates sessions associated with that device.
8. Every product endpoint requires authentication and resource-level authorization. Knowing a UUID, QR code or media URL is never sufficient permission.
9. Offline clients may read only data already cached and authorized. Offline mutations are queued with idempotency keys and re-authorized on the server at sync time; revoked access must not be bypassed by an old cache.

## Security requirements before production

- TLS everywhere; secrets held in a managed secret store.
- Strict issuer, audience, signature, expiry and algorithm validation.
- Short-lived access tokens; rotating refresh tokens stored as hashes only.
- Rate limits and abuse detection for sign-in, verification and recovery.
- Safe account linking; explicit verified email/phone semantics.
- Session/device inventory, revocation and audit events.
- Authorization tests for BOLA/IDOR across every user, space, album, post and media resource.
- No tokens, authorization headers, secrets or raw provider claims in logs.
- Secure token storage in iOS Keychain / Android Keystore; never SQLite.
- Threat model and privacy review before launch.

## Decision required

Choose one path before implementation:
- **A — Managed OIDC (recommended):** select the provider and supported sign-in methods.
- **B — Self-hosted OIDC:** identify the operator and hosting responsibility.
- **C — First-party credentials:** explicitly approve the additional credential schema and security scope.

Until approved, the API will not expose login, registration, refresh, account-linking or private product routes. Work may continue on provider-neutral contracts, infrastructure and tests without accepting unverified identities.

## Acceptance criteria

- Provider and sign-in methods approved and recorded.
- Provider metadata, issuer and audience configured per environment.
- Token validation tests cover invalid signature, issuer, audience, expiry, algorithm and missing subject.
- Identity mapping and account creation are transaction-safe and idempotent.
- Refresh rotation, reuse detection, logout and revocation are tested.
- Resource authorization tests deny cross-user and cross-space access.
- No private route is reachable without a validated MOMENTIA principal.
