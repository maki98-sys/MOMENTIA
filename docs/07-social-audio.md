# 07. Módulo Social Audio

## Propósito
Sesiones musicales grupales dentro de un evento, grupo o círculo autorizado. Cada teléfono reproduce localmente desde una fuente permitida; el servidor coordina el estado lógico y el instante objetivo. No sustituye ni garantiza el rendimiento de un equipo de sonido.

## Experiencia
1. Anfitrión crea sesión.
2. Miembros autorizados se unen.
3. Se muestra anfitrión, participantes, fuente y cola.
4. Participantes proponen canciones según permisos.
5. Anfitrión/coanfitrión controla reproducción.
6. Cada dispositivo regula volumen local.
7. Al reconectar, obtiene snapshot y resincroniza.

## Derechos y fuente musical — bloqueo de implementación real
Evaluar catálogo propio con licencias adecuadas, proveedor cuyo SDK/API permita expresamente reproducción sincronizada para el número de oyentes previsto, o contenido de usuario con derechos comprobables. Una suscripción personal no concede automáticamente retransmisión grupal. No extraer audio, eludir DRM, compartir archivos protegidos ni alojar copias sin autorización.

Si no existe una fuente autorizada, desarrollar primero infraestructura de sesión con pistas de prueba o música royalty-free/licenciada, sin anunciar integración comercial hasta aprobar términos y derechos por país.

## Estado autoritativo
AudioSession mantiene session_id, playback_state, track_reference, position_ms, server_timestamp, scheduled_start_at, state_version y host_id.

## Sincronización
- Cliente envía comando con versión esperada.
- Backend valida rol y estado.
- Backend calcula posición e instante futuro.
- Emite snapshot versionado.
- Clientes estiman desfase de reloj y programan inicio/seek.
- Clientes reportan latencia y estado.
- Resincronizar cuando desfase supere umbral.

La precisión se mide en dispositivos reales; no prometer sincronización sample-accurate ni latencia cero.

## Roles y controles
Host, co-host opcional, participante y moderador de cola. Volumen es local. Salir o silenciar un dispositivo no detiene a todos. Cola colaborativa y votación son configurables.

## Conexión y segundo plano
WebSocket autenticado, heartbeat, estado duradero en PostgreSQL y coordinación efímera en Redis. Reconexión obtiene snapshot; no depende de eventos perdidos. Sin Internet no hay sincronización remota garantizada; LAN/P2P es investigación aparte. Respetar audio focus, llamadas, alarmas, ahorro de batería, Bluetooth y restricciones de background en cada SO.

## Métricas y aceptación
Medir latencia de comandos, diferencia de inicio, desfase medio/percentiles, reconexión, errores de proveedor, interrupciones y batería. No acceder al micrófono: el módulo es de reproducción.

Aceptar solo si: membresía autorizada, controles por rol, cola consistente, resincronización tras desconexión, volumen individual, fuente licenciada y pruebas en Android/iOS/Bluetooth. Informar límites al usuario.
