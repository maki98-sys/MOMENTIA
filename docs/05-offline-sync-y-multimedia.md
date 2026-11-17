# 05. Offline-first, sincronización y multimedia

## Estados por operación
LOCAL_ONLY, QUEUED, UPLOADING, SERVER_PROCESSING, SYNCED, FAILED_RETRYABLE, FAILED_PERMANENT y CANCELLED. La interfaz debe distinguirlos y permitir reintentar/cancelar cuando sea seguro. Nunca mostrar “en la nube” antes de confirmación del servidor.

## Cola local persistente
Cada operación contiene operation_id, entity_id, type, payload_version, created_at, attempt_count, next_retry_at, dependency_ids y state. Persistir en base local transaccional; sobrevivir cierre forzado y reinicio.

Flujo de foto: crear operación → validar membresía → iniciar carga → transferir bytes → confirmar → procesar derivados → actualizar timeline. Cada paso debe ser idempotente.

## Reintentos y background
Backoff exponencial con jitter, límites, respeto a conectividad/batería/datos móviles y tratamiento separado de errores permanentes. Reanudar cargas multipart/chunk cuando proveedor lo soporte. iOS/Android pueden suspender o terminar tareas: usar APIs compatibles y no prometer ejecución continua.

## Conflictos
- Multimedia confirmada es inmutable; cambios de metadatos se versionan.
- Ediciones simples usan versión/ETag y resolución explícita.
- No usar last-write-wins para privacidad, permisos, propiedad o membresía.
- Revocaciones y eliminaciones de seguridad prevalecen.
- Tras reconectar, recuperar cursor de cambios y reconciliar.
- Si el usuario perdió acceso offline, rechazar operación pendiente e informar.

## Imagen y EXIF
1. Capturar/seleccionar.
2. Leer metadatos antes de transformación.
3. Validar firma real, MIME, tamaño, dimensiones y decodificación.
4. Calcular hash de integridad/dedupe.
5. Guardar temporal local.
6. Cargar a objeto privado.
7. Confirmar en servidor.
8. Worker genera miniaturas/derivados.
9. Registrar timeline y estado.
10. Servir con autorización.

Guardar separadamente:
- captured_at: fecha/hora original si es confiable.
- captured_timezone: zona conocida si existe.
- uploaded_at: recepción confirmada.
- published_at: publicación.
- created_at: creación del registro.

EXIF puede faltar o estar manipulado. No interpretar hora local sin zona como UTC. Permitir corrección manual y registrar origen/confianza. GPS desactivado por defecto y eliminado de derivados públicos salvo consentimiento.

## Caché y privacidad
Caché con límites por tamaño/edad, limpieza al cerrar sesión y controles para dispositivos compartidos. Álbumes offline selectivos y opt-in cuando sean sensibles.

## Object storage
Buckets privados, claves opacas, URLs firmadas de vida corta tras autorización, lifecycle para temporales/derivados y política de borrado.

## PWA
Puede cachear shell, mantener cola limitada y subir cuando navegador lo permita. Cuotas, cierre y background sync varían; al reabrir debe reanudar y mostrar límites.
