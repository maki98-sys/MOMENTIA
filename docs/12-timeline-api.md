# Space timeline API

## Endpoint

`GET /api/v1/spaces/:spaceId/timeline?limit=20&cursor=<opaque>`

Requires a valid authenticated session and active membership in the requested active space.

- `limit`: integer from 1 to 50; default 20.
- `cursor`: opaque base64url JSON cursor containing the last `occurredAt` and UUID `id`. The API validates both fields and uses the tuple `(occurred_at, id)` for stable descending pagination.
- Response: `items`, `nextCursor`, and `hasMore`.

Each item is either:
- `post`: author, display name, body, audience and publication time.
- `media`: asset ID, verified MIME type, byte size and dimensions. The client obtains a short-lived display/preview/thumbnail URL through the authorized media variants endpoint.

## Visibility

The query rechecks membership and content visibility on every page:
- Published posts must satisfy their audience (author, public, accepted relationship, or active membership in the post's space) and are hidden across user blocks.
- Media entries must be ready and not deleted; access requires ownership, a current space grant, or inclusion in an event album belonging to the current space.
- Hidden, draft, deleted, unprocessed or unauthorized items are not returned.

## Event album integration

Adding a ready photo to an event album inserts one `upload` timeline entry for that media asset in the event space. A partial unique index prevents duplicate media entries in the same space, even if the same photo is added to multiple albums. Removing an album item removes the timeline entry only when no other album in that space still references the photo.

## Boundaries

The timeline is a server-side projection; it does not store image bytes. The endpoint does not expose object-storage keys or signed URLs in timeline payloads. The client must request a media variant URL separately, which rechecks authorization and expires after 60 seconds.
