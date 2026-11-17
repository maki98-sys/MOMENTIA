# 03. Modelo de dominio y datos

Modelo lógico inicial; el esquema físico, índices, migraciones y constraints se definirán antes de implementar persistencia.

## Principios
UUID/ULID expuestos al cliente; fechas UTC con zona IANA cuando aplique; permisos verificados en servidor; separar identidad, membresía, contenido y bytes; definir retención y purga.

## Entidades

### Identidad
- User(id, email/phone normalizado y verificado, estado, created_at, deleted_at)
- AuthIdentity(user_id, provider, provider_subject)
- Device(id, user_id, platform, push_token gestionado, last_seen_at, revoked_at)
- Session(id, user_id, expires_at, revoked_at)

### Perfil y grafo social
- Profile(user_id, display_name, avatar_media_id, bio, visibility, preferences)
- Follow/Connection(requester_id, target_id, state)
- Block(blocker_id, blocked_id)
- UserReport(reporter_id, target_type, target_id, reason, status)

### Espacios
- Space(id, type EVENT|COUPLE|CIRCLE, owner_id, name, visibility, status, settings)
- SpaceMembership(space_id, user_id, role, state, joined_at, left_at)
- Invitation(id, space_id, token_hash, role, expires_at, max_uses, uses, approval_required, revoked_at)
- SpaceAuditEvent(actor_id, space_id, action, resource_type, resource_id, timestamp)

Un espacio COUPLE debe mantener exactamente dos membresías activas; validar transaccionalmente y con pruebas concurrentes.

### Detalles por tipo
- EventDetails(space_id, starts_at, ends_at, timezone, moderation_mode, download_policy)
- CoupleDetails(space_id, anniversary_date_optional, settings)
- CircleDetails(space_id, description, join_policy)
- EventAlbum(id, space_id, title, sort_mode)

### Multimedia
- MediaAsset(id, owner_id, storage_key_original, mime_type_detected, size_bytes, width, height, checksum, status)
- MediaVariant(id, media_asset_id, variant_type, storage_key, mime_type, size_bytes)
- MediaMetadata(media_asset_id, captured_at_utc_optional, captured_timezone_optional, device_metadata_optional, gps_encrypted_optional, consent)
- MediaUpload(id, media_asset_id, uploader_id, state, multipart_upload_id, bytes_received, last_error_code)
- MediaAccessGrant(media_asset_id, subject_type, subject_id, permission, expires_at), si el modelo lo requiere.

GPS no se almacena sin consentimiento explícito y necesidad funcional; EXIF sensible se elimina de derivados compartibles.

### Contenido
- Post(id, author_id, space_id_nullable, media_asset_id_nullable, text, audience, status, created_at, published_at)
- Comment(id, post_id, author_id, body, status, created_at)
- Reaction(id, target_type, target_id, user_id, reaction_type)
- TimelineEntry(id, space_id, post_id_nullable, media_asset_id_nullable, occurred_at, source)
- ModerationCase(id, reporter_id, target_type, target_id, reason, state, assigned_to)

space_id no reemplaza la audiencia: publicaciones sociales deben definir audiencia explícita.

### Audio
- AudioSession(id, space_id, host_user_id, state, source_provider, provider_context_id, current_item_id, position_ms, playback_state, scheduled_at, server_version)
- AudioQueueItem(id, session_id, added_by, provider_track_reference, position, state)
- AudioParticipant(session_id, user_id, device_id, joined_at, last_heartbeat_at, role)
- AudioVote(queue_item_id, user_id, vote)

No almacenar archivos protegidos ni credenciales de proveedores en texto plano.

### Plataforma
Notification, Subscription, Plan, PaymentEvent y AuditLog con IDs, estado, timestamps y referencias mínimas necesarias.

## Relaciones y reglas
- User 1:N Device, Session, Post y MediaAsset.
- Space 1:N Membership, Invitation, Post y TimelineEntry.
- Space 1:1 con EventDetails, CoupleDetails o CircleDetails según type.
- MediaAsset 1:N MediaVariant.
- AudioSession pertenece a Space y tiene QueueItems/Participants.
- Un usuario no duplica membresía activa.
- Invitaciones almacenan hash del token, no el secreto.
- Recursos multimedia requieren autorización antes de servir.
- Borrado de usuario resuelve propiedad y retención antes de purgar.
- Permisos, propiedad y membresía no usan “última escritura gana”.
- Índices para foreign keys, timeline/feed por fecha, membership lookup y estados de cola.

## Retención
Definir política por cuenta, posts, originales, derivados, auditoría, pagos y reportes. Documentar purga física y expiración de backups.


## Esquema físico inicial
La migración PostgreSQL está en database/migrations/0001_initial_schema.sql. La migración incremental database/migrations/0002_space_integrity_and_event_albums.sql añade álbumes colaborativos de eventos y restricciones diferidas para exigir un subtipo coincidente con EVENT, COUPLE o CIRCLE. La prueba inicial está en database/tests/constraints.sql.

**Estado de verificación:** archivos fuente creados en la rama; todavía no ejecutados contra un servidor PostgreSQL. La fase no se considera completada hasta ejecutar migraciones y pruebas, incluyendo concurrencia y restauración.
