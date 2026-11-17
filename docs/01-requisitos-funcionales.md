# 01. Requisitos funcionales

**Prioridad:** P0 imprescindible para una primera versión utilizable; P1 importante; P2 evolución. Todos los requisitos permanecen en el alcance global.

## Cuenta e identidad
- RF-ACC-001 (P0): registro, verificación, inicio/cierre de sesión y recuperación segura.
- RF-ACC-002 (P0): perfil, preferencias y gestión de dispositivos/sesiones.
- RF-ACC-003 (P0): revocar sesiones y eliminar cuenta conforme a política.
- RF-ACC-004 (P1): Apple/Google cuando se cumplan requisitos de proveedor y tiendas.

## Espacios e invitaciones
- RF-SPC-001 (P0): crear espacios EVENT, COUPLE y CIRCLE.
- RF-SPC-002 (P0): roles contextuales, membresías y transferencia de propiedad.
- RF-SPC-003 (P0): invitar por enlace/QR con token aleatorio, expiración, límite de usos, aprobación y revocación.
- RF-SPC-004 (P0): aislar contenido, miembros y permisos por espacio.
- RF-SPC-005 (P1): PWA de invitado para flujos limitados de eventos.

## Eventos y grupos
- RF-EVT-001 (P0): nombre, descripción, fechas, zona horaria, visibilidad y política de moderación.
- RF-EVT-002 (P0): subida individual/múltiple y galería cronológica colaborativa.
- RF-EVT-003 (P0): permisos de publicación, descarga, aprobación y reportes.
- RF-EVT-004 (P1): descarga individual/ZIP, archivo y retención del evento.

## Parejas
- RF-COU-001 (P0): espacio privado de exactamente dos miembros activos.
- RF-COU-002 (P0): diario con fotos, texto, hora/fecha y audiencia privada.
- RF-COU-003 (P1): estado de ánimo opcional, aniversarios y recuerdos.
- RF-COU-004 (P0): revocar acceso, salir o cerrar el espacio con reglas de propiedad y retención.
- RF-COU-005 (P0): ubicación opcional, granular y desactivada por defecto.

## Círculos privados
- RF-CIR-001 (P1): crear círculos, administrar miembros y roles.
- RF-CIR-002 (P1): álbumes, publicaciones, comentarios y cronologías privadas.
- RF-CIR-003 (P1): invitación, aprobación, reportes y salida.

## Red social
- RF-SOC-001 (P1): perfiles con visibilidad configurable.
- RF-SOC-002 (P1): publicaciones con audiencia elegida y feed paginado.
- RF-SOC-003 (P1): seguir/conectar, dejar de seguir, bloquear y silenciar.
- RF-SOC-004 (P1): reacciones, comentarios y reportes.
- RF-SOC-005 (P1): moderación y descubrimiento sin exponer contenido privado.

## Fotos y multimedia
- RF-MED-001 (P0): cámara, galería, selección múltiple y validación.
- RF-MED-002 (P0): originales según política/cuota y miniaturas/derivados.
- RF-MED-003 (P0): extraer metadatos antes de transformaciones que los eliminen.
- RF-MED-004 (P0): separar captured_at, uploaded_at y published_at.
- RF-MED-005 (P0): deduplicación/integridad, descarga autorizada y recuperación de cargas.
- RF-MED-006 (P1): recuerdos y álbumes automáticos con controles del usuario.

## Offline y sincronización
- RF-OFF-001 (P0): captura y preparación local sin Internet.
- RF-OFF-002 (P0): cola local persistente, reintentos y estados visibles.
- RF-OFF-003 (P0): reanudación de carga cuando la plataforma/proveedor lo permita.
- RF-OFF-004 (P0): reconciliación y conflictos; revocaciones de seguridad prevalecen.
- RF-OFF-005 (P1): caché selectiva para consulta offline.

## Social Audio
- RF-AUD-001 (P1): crear/unirse/salir de sesiones dentro de espacios autorizados.
- RF-AUD-002 (P1): estado de reproducción coordinado, cola colaborativa y votación.
- RF-AUD-003 (P1): anfitrión/coanfitrión, controles y volumen local independiente.
- RF-AUD-004 (P1): reconexión y resincronización.
- RF-AUD-005 (P0): fuente musical con derechos y términos compatibles; no subir ni retransmitir música protegida sin autorización.
- RF-AUD-006 (P1): comunicar límites de latencia y compatibilidad.

## Notificaciones, administración y monetización
- RF-NOT-001 (P1): invitaciones, actividad y preferencias por categoría/espacio; vistas previas privadas por defecto.
- RF-ADM-001 (P1): panel de usuarios, espacios, reportes, auditoría y salud del servicio.
- RF-BIL-001 (P1): planes, límites, pagos, webhooks idempotentes, cancelación y reembolsos.
- RF-SUP-001 (P1): reportes y soporte con trazabilidad.

## Aceptación transversal
No basta una pantalla: cada requisito requiere validación, autorización de servidor, estados de error/carga, pruebas, accesibilidad básica, documentación y evidencia de aceptación.
