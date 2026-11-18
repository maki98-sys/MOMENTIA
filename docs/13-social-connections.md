# Social connections and safety API

All routes require an authenticated bearer session. User IDs in paths are UUIDs and the server always derives the acting user from the verified identity.

## Follow requests

- `POST /api/v1/users/:userId/follow`: create a pending request, return the existing state idempotently, or accept automatically when there is a reciprocal pending/accepted request.
- `POST /api/v1/users/:userId/follow/accept`: accept a pending request sent by the path user and create the reciprocal accepted relationship.
- `POST /api/v1/users/:userId/follow/reject`: reject a pending request sent by the path user.
- `DELETE /api/v1/users/:userId/follow`: remove the relationship in both directions.

The service locks both active user rows in deterministic UUID order before changing relationship state. It refuses new relationships if either user has blocked the other. Self-follow is rejected.

## Blocking

- `POST /api/v1/users/:userId/block`: create a block and remove relationships in both directions in the same transaction.
- `DELETE /api/v1/users/:userId/block`: remove the block created by the authenticated user.

Blocking is directional for the block record, but either direction prevents a new follow relationship. Existing feed and media visibility queries already suppress content across user blocks.

## Lists and request inbox

- `GET /api/v1/me/following`
- `GET /api/v1/me/followers`
- `GET /api/v1/me/follow-requests`

Each list accepts `limit` (1–50, default 20) and an opaque cursor. The query filters inactive accounts and either-direction blocks before returning profile display name and avatar media ID.

## Boundaries

This module manages relationship state and blocks. Push notifications, request inbox UI, discovery/search, profile recommendations, and full follower/following list APIs are separate work items.
