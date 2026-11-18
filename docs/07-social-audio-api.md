# Social Audio — API inicial y límites de integración

## Alcance implementado

El módulo `AudioModule` está registrado en NestJS y protegido por `OidcBearerGuard`. Las rutas usan el prefijo global de la API (`/api/v1`, si está habilitado en el bootstrap).

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/spaces/:spaceId/audio-sessions` | Crear sesión; requiere owner/admin/moderator del espacio |
| GET | `/spaces/:spaceId/audio-sessions/active` | Consultar sesión activa siendo miembro |
| GET | `/audio-sessions/:sessionId` | Consultar sesión, cola y participantes siendo miembro |
| POST | `/audio-sessions/:sessionId/join` | Unirse como oyente |
| POST | `/audio-sessions/:sessionId/leave` | Salir de la sesión |
| POST | `/audio-sessions/:sessionId/queue` | Añadir referencia de pista del proveedor |
| DELETE | `/audio-sessions/:sessionId/queue/:itemId` | Retirar elemento; solo anfitrión |
| PATCH | `/audio-sessions/:sessionId/playback` | Controlar reproducción; solo anfitrión |
| POST | `/audio-sessions/:sessionId/queue/:itemId/vote` | Votar una pista como participante activo |

## Reglas y consistencia

- El acceso se valida contra la membresía activa del espacio.
- Solo owner/admin/moderator puede crear una sesión.
- Solo el anfitrión puede controlar la reproducción y retirar elementos de la cola.
- Los cambios incrementan `server_version`; el control de reproducción acepta `expectedVersion` para detectar escrituras concurrentes.
- La cola almacena referencias del proveedor, no archivos de audio.
- La migración `0007_audio_participant_uniqueness` añade unicidad para participantes sin dispositivo y evita duplicados por la semántica de NULL de PostgreSQL.

## Fuera del alcance actual

- No se transmite ni redistribuye audio musical.
- No hay todavía adaptador OAuth/SDK de Spotify, Apple Music o YouTube Music.
- No hay WebSocket/realtime gateway, heartbeat periódico ni recuperación de reconexión.
- No hay sincronización de reloj/latencia entre dispositivos ni cliente móvil.
- El cliente deberá reproducir contenido mediante un proveedor autorizado y sujeto a sus licencias, SDK, suscripciones y restricciones regionales.

## Próximas tareas técnicas

1. Añadir gateway WebSocket autenticado y eventos de sesión versionados.
2. Añadir heartbeat y expiración de participantes desconectados.
3. Completar transiciones de cola (next/skip/reorder) en transacciones.
4. Añadir pruebas de integración PostgreSQL para creación, membresía, anfitrión, concurrencia y aislamiento.
5. Implementar cliente móvil y sincronización de estado local con el servidor.
6. Evaluar proveedor musical autorizado antes de comprometer reproducción sincronizada real.


## Presencia y heartbeat (REST inicial)

- `POST /audio-sessions/:sessionId/heartbeat` renueva `last_heartbeat_at` del participante autenticado.
- Solo se acepta si la participación sigue activa, el espacio mantiene la membresía activa y la sesión está en estado `created`, `playing` o `paused`.
- El endpoint no incrementa `server_version`: un ping de presencia no es un cambio de reproducción ni debe invalidar comandos optimistas de playback.
- Si el usuario ya salió, fue retirado del espacio o la sesión terminó, responde como participación no encontrada.
- Este endpoint permite establecer presencia básica; no reemplaza WebSockets, detección automática de desconexión ni sincronización audiovisual en tiempo real.
