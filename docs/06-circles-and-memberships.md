# Círculos privados y membresías

## Estado implementado en backend

Los círculos se representan como espacios de tipo `CIRCLE`. La creación de un círculo y de su propietario se realiza en una sola transacción PostgreSQL y crea el registro correspondiente en `circle_details`.

### Rutas disponibles

Todas requieren token Bearer OIDC válido.

- `GET /api/v1/spaces`: espacios activos del usuario.
- `POST /api/v1/spaces`: crear círculo con `type: "CIRCLE"`, nombre, visibilidad y descripción opcional.
- `GET /api/v1/spaces/:spaceId`: detalle solo para miembros activos.
- `GET /api/v1/spaces/:spaceId/members`: lista de miembros; requiere pertenencia activa.
- `PATCH /api/v1/spaces/:spaceId/members/:userId/role`: cambia rol según jerarquía.
- `DELETE /api/v1/spaces/:spaceId/members/:userId`: retira a otro miembro con permiso.
- `POST /api/v1/spaces/:spaceId/members/transfer-ownership`: transfiere la propiedad a otro miembro activo, actualiza `spaces.owner_id` y ambos roles en una transacción, y registra el evento de auditoría. Solo el propietario actual puede hacerlo.\n- `POST /api/v1/spaces/:spaceId/members/leave`: permite salir salvo que el usuario sea propietario.
- `POST /api/v1/spaces/:spaceId/invitations`: genera invitación de un solo uso para miembro o invitado.
- `GET /api/v1/spaces/:spaceId/invitations`: lista invitaciones para propietario/administrador.
- `POST /api/v1/invitations/accept`: acepta invitación válida.
- `GET /api/v1/spaces/:spaceId/albums`: lista álbumes visibles para el miembro.\n- `GET /api/v1/spaces/:spaceId/albums/:albumId/items`: lista fotos listas para mostrarse, con cursor estable (`cursor` + `cursorId`) y límite de página.\n- `POST /api/v1/spaces/:spaceId/albums/:albumId/items`: agrega una foto propia y lista para mostrarse.\n- `DELETE /api/v1/spaces/:spaceId/albums/:albumId/items/:itemId`: retira el elemento; creador o moderador autorizado.\n- `GET/POST /api/v1/spaces/:spaceId/timeline`: cronología con paginación estable por fecha e ID.
- `GET/POST /api/v1/spaces/:spaceId/timeline`: recuerdos de la cronología.

## Reglas de seguridad

- Los espacios privados solo son visibles para miembros activos.
- La API no confirma si existe un espacio al que el usuario no tiene acceso.
- Solo propietario/administrador puede invitar.
- Solo propietario puede promover a administrador.
- No se puede retirar ni degradar al propietario mediante las rutas comunes; la transferencia debe ejecutarse explícitamente.\n- La transferencia de propiedad bloquea la fila del espacio, exige que el destinatario ya sea miembro activo, cambia los roles y el propietario del espacio de forma atómica, y escribe un evento de auditoría.
- Las invitaciones usan tokens aleatorios, se almacena su hash SHA-256 y tienen expiración y un uso máximo.
- Un miembro expulsado no puede volver a entrar usando la misma invitación.
- El enlace QR puede transportar el token de invitación, pero la interfaz QR y el flujo de cámara aún no están implementados.

## Pendiente antes de producción

- Recuperación del círculo si el propietario pierde acceso (proceso de soporte y verificación aún pendiente).
- Solicitud de ingreso y aprobación para círculos con `join_policy = approval`.
- Bloqueo, reportes, moderación y registro de auditoría de acciones.
- Notificaciones push y sincronización offline de cambios de membresía.
- Cliente móvil, pantalla de administración, QR y pruebas E2E.
