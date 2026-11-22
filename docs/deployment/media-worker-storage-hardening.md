# Media worker storage deployment hardening

This document is an operational release gate for the media worker. Passing application CI does **not** configure or prove the security of a cloud storage account, bucket policy, IAM role, volume, proxy, or malware-scanner deployment.

## Provider selection

- Use `MEDIA_STORAGE_PROVIDER=s3` for a multi-replica production deployment. Configure `MEDIA_S3_BUCKET` and `MEDIA_S3_REGION`; use the platform's workload identity/IAM role where available.
- Do not bake static S3 credentials into the image, source tree, CI artifacts, or `.env` committed to Git. If static credentials are unavoidable, use a dedicated short-lived/rotated identity and configure both access-key variables through a secret manager.
- Keep the bucket private. Disable public access at account and bucket level; do not enable public ACLs or public website hosting for media.
- Require TLS for all S3 API traffic. Configure default server-side encryption (prefer a customer-managed KMS key where required by policy) and restrict key use to the worker/API roles.
- Scope API and worker IAM permissions to the one bucket and required prefixes/actions. The worker needs object read/write/delete for processing and deletion; the API needs only the operations it actually performs. Do not grant account-wide S3 administration or bucket-policy mutation to either runtime role.
- Configure lifecycle cleanup for abandoned multipart uploads if multipart object uploads are enabled by the chosen provider. Define retention and recovery policy for object versions separately; lifecycle rules must not delete live media variants.
- Confirm bucket region, endpoint, path-style mode, encryption, retention and IAM permissions in a non-production environment before rollout.

## Local filesystem provider

The local provider is intended for a single-instance or development deployment, not a horizontally scaled production service. The API and worker must share the same persistent volume and agree on the storage root.

The worker container runs as the unprivileged `node` user. If using the default `/var/lib/momentia/media` path, provision the mounted volume with ownership and permissions that allow that UID/GID to access only the media root. Do not solve permission errors by running the worker as root or making the volume world-writable.

Mount the media root and worker staging directory from dedicated volumes/directories. Restrict write access to the worker/API service identities; do not allow users, upload clients, or unrelated containers to create files, directories, or symlinks inside these roots. Use restrictive directory permissions and, where supported, mount options such as `nodev,nosuid,noexec`.

The worker currently checks path components with `lstat` before filesystem operations. This rejects pre-existing symlinks and path traversal, but it is a preflight check, **not an atomic open-relative-to-directory operation**. A hostile process with write access to the storage root could race the check and replace a path component before the subsequent filesystem call (TOCTOU). Therefore the storage root must not be writable by untrusted principals. A future hardened local adapter should use OS primitives that anchor operations to trusted directory file descriptors and refuse symlinks atomically (for example, `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` on Linux), or use a private object-storage service.

## Worker and scanner

- Generate a random `MEDIA_WORKER_TOKEN` of at least 32 characters, use a separate secret for any maintenance-worker endpoints, and rotate both through a coordinated deployment.
- Keep the API worker endpoints private to the service network; do not expose them through the public ingress. Network isolation is additional defense, not a replacement for token authentication.
- Configure ClamAV in production and verify a clean-file scan, an EICAR test-file rejection, scanner timeout, and scanner-unavailable behavior. Scanner-unavailable must remain fail-closed (quarantined, not published).
- Limit CPU, memory, temporary disk, concurrency and processing time for image/video workloads. Alert on repeated failures, dead-lettered storage deletions, stale leases, quarantined assets and worker restarts.
- Restrict the worker's writable staging directory to the worker identity. Ensure temporary files are removed on success, failure and container restart according to the deployment's volume policy.

## Release verification checklist

- [ ] Private bucket, public access blocked, TLS enforced.
- [ ] Encryption at rest and key permissions verified.
- [ ] Least-privilege IAM tested for API and worker separately.
- [ ] Lifecycle/retention/versioning behavior reviewed against media deletion requirements.
- [ ] Worker token and maintenance token provisioned from a secret manager.
- [ ] API internal routes are not publicly routed.
- [ ] Shared-volume ownership is correct if using local storage; local mode is not scaled across replicas.
- [ ] ClamAV clean, infected, timeout and unavailable cases verified in the deployment environment.
- [ ] Alerts exist for dead-letter queues, stale leases, failed scans and storage errors.
- [ ] Restore and deletion-reconciliation procedures tested before production traffic.

These are deployment acceptance criteria; repository CI can test code paths and migrations but cannot certify the live cloud account or infrastructure configuration.

## API storage adapter notes

The API's local adapter applies the same `lstat` preflight policy to writes, reads, stream location and removal. This blocks pre-existing symlink components in those paths, but it has the same TOCTOU limitation described above: it does not make path validation and the later filesystem operation atomic. The API media root must therefore be protected from writes by upload clients and unrelated processes. Keep the API and worker roots on the same trusted persistent volume when using local storage.

The API and worker S3 adapters currently issue object writes without per-request server-side-encryption headers. Production S3 deployments must therefore enforce default bucket encryption (prefer SSE-KMS with a customer-managed key where required) and verify it with a real upload/read/delete test before release. A bucket policy should deny non-TLS requests and prevent public access; runtime roles must not be allowed to weaken these controls. Repository CI does not inspect or certify these live bucket settings.
