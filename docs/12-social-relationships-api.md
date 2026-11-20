# Relaciones sociales: API de seguimiento y bloqueo

Base URL: API MOMENTIA. Todos los endpoints requieren bearer token OIDC válido.

## Seguir a una persona

`POST /users/:userId/follow`

- No permite seguir la propia cuenta.
- La cuenta objetivo debe estar activa y tener perfil.
- Un perfil con visibilidad `public` genera relación `accepted`.
- Un perfil `followers` genera solicitud `pending`.
- Un perfil `private` no aparece en el descubrimiento social y la operación responde como no encontrado.
- No se permite crear la relación si existe bloqueo en cualquiera de las dos direcciones.
- Repetir la operación es idempotente a nivel de relación: no duplica filas y conserva una relación ya aceptada.

## Dejar de seguir

`DELETE /users/:userId/follow`

Elimina la relación iniciada por el usuario autenticado hacia la cuenta indicada. No altera la relación inversa.

## Solicitudes recibidas

- `GET /follow-requests`: lista hasta 100 solicitudes pendientes recibidas.
- `POST /follow-requests/:requesterId/accept`: acepta una solicitud dirigida al usuario autenticado.
- `POST /follow-requests/:requesterId/reject`: rechaza una solicitud dirigida al usuario autenticado.

Solo el destinatario puede resolver una solicitud. Las solicitudes inexistentes, ya resueltas o afectadas por un bloqueo responden como no encontradas.

## Bloquear y desbloquear

- `POST /users/:userId/block`: bloquea una cuenta activa.
- `DELETE /users/:userId/block`: elimina el bloqueo creado por el usuario autenticado.

Bloquear elimina, en la misma transacción, las relaciones de seguimiento en ambas direcciones. La consulta del feed y la lectura de perfiles/posts ya excluyen cuentas bloqueadas en cualquiera de las direcciones.

## Modelo de relación

La tabla `user_relationships` mantiene `requester_id`, `target_id` y estado `pending | accepted | rejected`. La tabla `user_blocks` almacena bloqueos dirigidos con clave primaria `(blocker_id, blocked_id)`.

## Límites conocidos

- No hay todavía endpoints paginados de listas públicas de seguidores/seguidos.
- No hay notificaciones de seguimiento/solicitud en este módulo.
- No se implementa descubrimiento de personas ni recomendaciones.
- La autorización del feed y del perfil aplica bloqueos y estados aceptados; se deben mantener pruebas de regresión al ampliar consultas sociales.
