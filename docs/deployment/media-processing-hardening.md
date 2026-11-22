# Media processing deployment and verification

This runbook describes the operational controls required by the API and media worker. Passing repository tests does not prove that a deployed bucket, scanner, IAM policy, or host has the same configuration.

## Worker limits implemented in code

- `MEDIA_FFMPEG_TIMEOUT_MS`: worker-enforced FFmpeg wall-clock limit, clamped to 1,000–300,000 ms; default 120,000 ms.
- `MEDIA_MAX_IMAGE_PIXELS`: Sharp decoded-pixel limit, clamped to 1,000,000–100,000,000; default 40,000,000.
- FFmpeg poster extraction is restricted to `file,pipe` protocols, caps a single allocation at 64 MiB, and caps poster output at 20 MiB.
- FFmpeg diagnostics are retained in a bounded buffer. A timeout sends SIGTERM and escalates to SIGKILL if the child does not exit.
- ClamAV results are accepted only as complete `stream: OK` or `stream: ... FOUND` responses. Scanner errors, timeouts, and premature disconnects fail closed.
- S3 variant uploads include SHA-256 and are checked with `HeadObject` (content length and checksum) before the worker reports success. Failed verification triggers a best-effort object delete.

## API upload streaming and temporary disk

- Direct uploads are streamed from the HTTP request into a uniquely created temporary file; the API no longer concatenates a 200 MiB request body into one in-memory Buffer.
- Multipart part requests are streamed to temporary files and are capped at 8 MiB while receiving the body.
- The API verifies the staged file size, SHA-256 and media signature before storage. Ownership is checked before the request body is accepted and is rechecked before database state changes.
- Local storage copies staged files through streams and atomically renames the completed temporary object. S3 uploads use a file stream and an explicit content length.
- Resumable assembly reads one stored part stream at a time, verifies each part checksum, writes incrementally to a staged file and verifies the final whole-file checksum. It does not concatenate the full upload in memory.
- Staging files are created under the operating system temporary directory (Node.js `os.tmpdir()`; typically controlled by `TMPDIR`) and removed after the request or assembly completes, including error paths.
- `MEDIA_UPLOAD_STAGING_MAX_CONCURRENT` caps active direct/multipart request staging per API process (default 4; allowed 1–32). `MEDIA_UPLOAD_ASSEMBLY_MAX_CONCURRENT` caps active resumable assemblies per API process (default 2; allowed 1–8). Excess requests receive HTTP 429 and can retry.
- These are per-process limits, not a cluster-wide quota. Multiply by the number of API replicas when sizing disk and setting deployment limits.
- Provision a private, writable temporary filesystem with enough free space for concurrent upload staging and resumable assembly. Apply container/host disk quotas, alert on free space and clean abandoned `momentia-upload-` / `momentia-assembly-` directories after unclean process termination. Per-request size limits do not by themselves cap aggregate concurrent disk use.

## Required deployment configuration

### ClamAV

- Configure a reachable, private ClamAV daemon and set `CLAMD_HOST` and `CLAMD_PORT`.
- Configure daemon stream/file limits to support the largest upload allowed by the active subscription plan (the platform hard ceiling is 200 MiB).
- Ensure the scanner's timeout and capacity are compatible with worker concurrency and file size.
- Keep signatures updated and alert on scanner disconnects, timeouts, rejected files, and repeated scan failures.
- Run an EICAR integration test in a non-production test environment and prove that the asset remains quarantined and no variants become visible.

### S3 / compatible object storage

- Keep the bucket private; enable block-public-access controls and deny non-TLS requests.
- Use separate least-privilege identities for API and worker. Restrict object operations to the required original, variant, upload-part, and deletion prefixes.
- Configure SSE-S3 or SSE-KMS. For SSE-KMS, grant only the required key operations to the API/worker roles and verify that checksum-enabled HEAD requests work with the key policy.
- Enable versioning or an equivalent recovery strategy where required by the retention policy; define lifecycle rules for abandoned staging objects and old versions.
- Verify IAM, bucket policy, KMS policy, encryption, lifecycle and cross-account isolation in the actual target account. Unit tests only verify request parameters and mocked behavior.

### Local storage

- Mount the media root so only trusted API/worker service identities can write to it.
- The symlink checks are preflight checks, not an atomic TOCTOU defense. Do not allow untrusted local users or sidecars to mutate the media root. Use descriptor-relative OS primitives or private object storage where stronger race-free guarantees are required.

## Release acceptance tests still required

- Real JPEG, PNG, WebP, HEIC/HEIF and supported video samples, including malformed, truncated, oversized and adversarial files.
- EXIF rotation and proof that generated variants do not retain GPS or other private metadata.
- ClamAV clean, EICAR, unavailable, slow, timeout, malformed response and signature-update cases against a real daemon.
- FFmpeg malformed input, missing video stream, unsupported codec, hang/timeout and resource-exhaustion cases in the production container.
- S3 upload/download/delete isolation between users, checksum mismatch, missing-object and permission-denied cases against a disposable test bucket.
- Load tests for concurrent uploads and processing, CPU/memory/temp-disk ceilings, storage-full behavior and worker crash recovery.
- Reconciliation of objects without database rows and database rows whose objects are missing; safe dead-letter inspection/retry and account-deletion recovery.
- Alerting and dashboards for processing latency, failed/quarantined jobs, stale leases, dead letters, orphan objects and storage usage.

## Known scope boundary

The current video worker generates a poster; it does not perform full video transcoding or adaptive-bitrate packaging. That requires a separate product/architecture decision covering target codecs, resolutions, playback formats, storage cost and device compatibility.
