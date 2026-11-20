# Círculos privados y membresías

## Estado implementado en backend

Los círculos se representan como espacios de tipo `CIRCLE`. La creación de un círculo y de su propietario se realiza en una sola transacción PostgreSQL y crea el registro correspondiente en `circle_details`.

### Rutas disponibles

Todas requieren token Bearer OIDC válido.

- `GET /api/v1/spaces`: espacios activos del usuario.
- `POST /api/v1/spaces`: crear círculo (`CIRCLE`) o evento (`EVENT`) con nombre, visibilidad y metadatos iniciales.
- `PATCH /api/v1/spaces/:spaceId/event`: actualiza nombre, fechas, zona horaria, modo de moderación y política de descargas; requiere rol owner/admin y registra auditoría.
- `GET /api/v1/spaces/:spaceId`: detalle solo para miembros activos.
- `GET /api/v1/spaces/:spaceId/members`: lista de miembros; requiere pertenencia activa.
- `POST /api/v1/spaces/:spaceId/join-requests`: solicita ingreso a un círculo público/no listado configurado con aprobación.
- `GET /api/v1/spaces/:spaceId/join-requests`: propietario/administrador consulta solicitudes pendientes.
- `POST /api/v1/spaces/:spaceId/join-requests/:requestId/approve`: aprueba y activa la membresía.
- `POST /api/v1/spaces/:spaceId/join-requests/:requestId/reject`: rechaza una solicitud.
- `DELETE /api/v1/spaces/:spaceId/join-requests/:requestId`: el solicitante cancela su solicitud pendiente.
- `PATCH /api/v1/spaces/:spaceId/members/:userId/role`: cambia rol según jerarquía.
- `DELETE /api/v1/spaces/:spaceId/members/:userId`: retira a otro miembro con permiso.
- `POST /api/v1/spaces/:spaceId/members/transfer-ownership`: transfiere la propiedad a otro miembro activo, actualiza `spaces.owner_id` y ambos roles en una transacción, y registra el evento de auditoría. Solo el propietario actual puede hacerlo.
- `POST /api/v1/spaces/:spaceId/members/leave`: permite salir salvo que el usuario sea propietario.
- `POST /api/v1/spaces/:spaceId/invitations`: genera invitación de un solo uso para miembro o invitado.
- `GET /api/v1/spaces/:spaceId/invitations`: lista invitaciones para propietario/administrador.
- `POST /api/v1/invitations/accept`: acepta invitación válida para eventos y círculos.
- `POST /api/v1/couple-invitations`: crea una invitación privada de pareja para otra cuenta activa; entrega un token aleatorio y solo almacena su hash.
- `GET /api/v1/couple-invitations`: lista invitaciones entrantes y salientes sin exponer tokens.
- `DELETE /api/v1/couple-invitations/:invitationId`: revoca una invitación pendiente creada por el usuario.
- `POST /api/v1/couple-invitations/accept`: solo la cuenta invitada puede aceptar; crea el espacio privado y las dos membresías activas en una transacción.
- `GET /api/v1/spaces/:spaceId/albums`: lista álbumes visibles para el miembro.
- `GET /api/v1/spaces/:spaceId/albums/:albumId/items`: lista fotos listas para mostrarse, con cursor estable (`cursor` + `cursorId`) y límite de página.
- `POST /api/v1/spaces/:spaceId/albums/:albumId/items`: agrega una foto propia y lista para mostrarse.
- `DELETE /api/v1/spaces/:spaceId/albums/:albumId/items/:itemId`: retira el elemento; creador o moderador autorizado.
- `GET/POST /api/v1/spaces/:spaceId/timeline`: cronología con paginación estable por fecha e ID.
- `GET/POST /api/v1/spaces/:spaceId/timeline`: recuerdos de la cronología.

## Reglas de seguridad

- Los espacios privados solo son visibles para miembros activos.
- La API no confirma si existe un espacio al que el usuario no tiene acceso.
- Solo propietario/administrador puede invitar.
- Solo propietario puede promover a administrador.
- No se puede retirar ni degradar al propietario mediante las rutas comunes; la transferencia debe ejecutarse explícitamente.
- La transferencia de propiedad bloquea la fila del espacio, exige que el destinatario ya sea miembro activo, cambia los roles y el propietario del espacio de forma atómica, y escribe un evento de auditoría.
- Las invitaciones usan tokens aleatorios, se almacena su hash SHA-256 y tienen expiración y un uso máximo.
- Un miembro expulsado no puede volver a entrar usando la misma invitación.
- El enlace QR puede transportar el token de invitación, pero la interfaz QR y el flujo de cámara aún no están implementados.

## Pendiente antes de producción

- Recuperación del círculo si el propietario pierde acceso (proceso de soporte y verificación aún pendiente).
- Notificación al destinatario de invitaciones de pareja y entrega segura del enlace/token todavía requieren integración de notificaciones y cliente.
- Solicitudes de ingreso y aprobación para círculos públicos/no listados con `join_policy = approval` (seleccionable al crear el círculo) ya implementadas en backend; falta notificación al solicitante y pruebas E2E.
- Bloqueo, reportes, moderación y registro de auditoría de acciones.
- Notificaciones push y sincronización offline de cambios de membresía.
- Cliente móvil, pantalla de administración, QR y pruebas E2E.
