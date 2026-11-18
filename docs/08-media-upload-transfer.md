# Media upload byte-transfer contract

The authenticated API supports a two-step upload:

1. `POST /api/v1/media/uploads` with JSON metadata and a unique `Idempotency-Key`. The response includes the upload id and declared size.
2. `PUT /api/v1/media/uploads/:uploadId/content` with `Content-Type: application/octet-stream` and the exact file bytes.

The API enforces a 50 MiB limit, exact declared byte count, SHA-256 integrity, upload ownership and state. Files are written atomically with mode 0600 under `MEDIA_STORAGE_DIR` (default `/var/lib/momentia/media`). The configured directory must be on persistent storage and writable by the API process. The database marks accepted bytes as `uploaded` and the asset as `quarantined`; this deliberately does not make the asset visible or trusted.

Security and operational boundaries:
- This first adapter is local filesystem storage for a single API instance/development deployment. It is not shared across replicas and is not a substitute for production object storage.
- MIME is declared by the client and is not yet independently detected from file signatures. A media scanner/transcoder must inspect quarantined files before status can become `ready`.
- The client must compute SHA-256 and send the metadata before transfer. It must not retry with a new idempotency key for the same logical upload.
- A process crash between file write and database commit can leave an orphaned file; an orphan reconciliation worker is still required.
- Reverse proxy/body limits and streaming-to-disk rather than buffering must be configured before production rollout. The controller currently buffers at most 50 MiB per request.
- No S3-compatible provider, CDN, public media URL or background image/video processing is configured by this change.
