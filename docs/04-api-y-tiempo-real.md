# 04. API, autorización y tiempo real

## Convenciones
- Prefijo `/api/v1`, JSON UTF-8, fechas ISO 8601 UTC.
- UUID/ULID públicos.
- Paginación por cursor.
- Errores con código estable, mensaje seguro y correlation_id.
- Idempotency-Key para operaciones reintentables.
- OpenAPI como contrato.
- Validación DTO en cada entrada.

## Endpoints iniciales

**Cuenta (parcialmente implementada):** GET /me/profile y PUT /me/profile requieren bearer token válido y operan exclusivamente sobre el usuario autenticado. PUT acepta `displayName` (1–80 caracteres), `bio` (hasta 500 caracteres o null) y `visibility` (`private`, `followers` o `public`; predeterminado `private`). El GET devuelve `profile: null` si el usuario todavía no ha creado su perfil. Registro/login/refresh/logout y sesiones siguen pendientes.

**Espacios:** POST /spaces; GET /spaces; GET/PATCH /spaces/{spaceId}; GET /spaces/{spaceId}/members; POST /spaces/{spaceId}/invitations; POST /invitations/accept.

**Eventos/media:** POST /spaces/{spaceId}/albums; GET /spaces/{spaceId}/timeline; POST /spaces/{spaceId}/media; GET /media/{mediaId}; POST /media/{mediaId}/download-grant.

**Social:** POST /posts; GET /feed; GET /posts/{postId}; POST /posts/{postId}/comments; POST /posts/{postId}/reactions; POST /users/{userId}/follow; POST /users/{userId}/block; POST /reports.

**Audio:** POST /spaces/{spaceId}/audio-sessions; POST /audio-sessions/{sessionId}/join|leave; PATCH /audio-sessions/{sessionId}/playback; POST /audio-sessions/{sessionId}/queue; POST /audio-sessions/{sessionId}/queue/{itemId}/vote; GET /audio-sessions/{sessionId}.

**Sync/uploads:** POST /sync/operations; GET /sync/changes?cursor=...; POST /uploads; POST /uploads/{uploadId}/complete|abort.

Los endpoints marcados como implementados existen en código; el resto sigue siendo contrato de diseño y no debe considerarse disponible. Cada nuevo endpoint debe añadir DTO/validación, permisos, pruebas y documentación antes de marcarse como implementado.

## Autorización por petición
Comprobar identidad, sesión, estado de cuenta, pertenencia activa, rol, permiso, audiencia, bloqueos, moderación y estado del recurso. Proteger contra BOLA/IDOR. Nunca confiar en controles de interfaz.

## WebSocket
Canal autenticado, autorizado por espacio/sesión. Eventos propuestos: space.member.joined/left, media.upload.completed, timeline.entry.created, post.created/updated, notification.created, audio.session.state, audio.queue.updated, audio.participant.joined/left y sync.cursor.updated.

Cada evento incluye event_id, event_type, aggregate_id, version, occurred_at y payload mínimo. No emitir datos privados a salas no autorizadas.

## Tiempo real confiable
Los eventos pueden duplicarse, retrasarse o perderse. Deduplicar por event_id, ordenar por versión de agregado y reconciliar con snapshot/GET después de reconectar. Heartbeat indica presencia aproximada, no prueba de actividad humana.

## Abuso y versionado
Rate limits para auth, invitaciones, comentarios, archivos, audio y reportes. Versionar API; mantener compatibilidad móvil razonable y comunicar versión mínima soportada.
