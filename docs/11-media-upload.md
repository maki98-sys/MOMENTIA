# Media upload API — fase inicial

## Configuración privada de objetos

La API admite un endpoint S3-compatible (por ejemplo, Cloudflare R2) mediante variables de entorno:

- `S3_ENDPOINT`: endpoint HTTPS de la cuenta/servicio.
- `S3_BUCKET`: bucket privado.
- `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY`: credenciales de servicio con permisos mínimos sobre el bucket.
- `S3_REGION`: región de firma; `auto` por defecto para proveedores compatibles como R2.

Las cuatro primeras variables deben configurarse juntas. No incluir credenciales en Git, imágenes, logs ni respuestas API. El bucket debe permanecer privado y el acceso público debe estar desactivado. La política del proveedor debe limitar la identidad a los objetos del bucket de MOMENTIA.

## Flujo implementado

1. El cliente autenticado solicita `POST /api/v1/media/uploads` con `Idempotency-Key`, nombre de archivo, MIME declarado, tamaño y SHA-256 declarado.
2. El servidor valida campos, permite JPEG/PNG/WebP y limita el archivo a 25 MiB.
3. La API crea registros de propietario y carga, mantiene el MIME y checksum declarados en columnas separadas de los valores verificados, y genera una URL PUT firmada de 10 minutos para una clave opaca.
4. El cliente envía los bytes directamente al bucket usando exactamente el encabezado Content-Type devuelto.
5. El cliente llama `POST /api/v1/media/uploads/:uploadId/complete`.
6. El servidor realiza HEAD al objeto privado, descarga con límite estricto de bytes, valida firma JPEG/PNG/WebP y recalcula SHA-256.
7. Si las comprobaciones coinciden, el servidor registra `uploaded` y encola `media_processing_jobs` en la misma transacción; si no coinciden, marca el asset como `quarantined` y la carga como `failed`.

Las URLs firmadas son temporales. El endpoint de finalización exige que la carga y el asset pertenezcan al usuario autenticado.

## Procesamiento en segundo plano

Después de validar bytes y hash, el servidor inserta un job durable en `media_processing_jobs` dentro de la misma transacción que confirma la carga. El worker procesa una tarea a la vez por instancia, y varias instancias coordinan sus claims mediante `SKIP LOCKED`. Los reintentos usan backoff y leases para recuperar procesos interrumpidos. El original se sustituye en la referencia de base de datos por un WebP saneado; tras confirmar las variantes, se intenta borrar el objeto original sin procesar. Si falla esa limpieza, el objeto original permanece privado y requiere limpieza posterior.

## Limitaciones explícitas de esta fase

- El MIME y SHA-256 enviados al iniciar la carga son declaraciones del cliente. Al completar, el servidor descarga el objeto privado (máximo 25 MiB), inspecciona firmas binarias JPEG/PNG/WebP y recalcula SHA-256. Si MIME real o hash no coinciden, marca el asset como `quarantined` y la carga como `failed`. Los campos verificados solo se actualizan cuando ambas comprobaciones coinciden.
- Tras verificar bytes y hash, el asset permanece `pending` hasta que un worker procese la tarea durable. La cola ya está persistida y admite reintentos/leases; el worker, la decodificación segura, eliminación EXIF/GPS, variantes y publicación automática en timeline siguen pendientes. No se marca como `ready`.
- El consumidor worker ya está implementado con Sharp: valida decodificación, limita a 40 millones de píxeles y una sola página, aplica orientación, re-encodea a WebP sin copiar EXIF/GPS y genera thumbnail (320 px), preview (1280 px) y display (2048 px). Solo marca `ready` tras guardar las tres variantes y actualizar metadatos en una transacción.
- La cola PostgreSQL es durable: jobs únicos por asset, `FOR UPDATE SKIP LOCKED`, leases de 10 minutos, máximo de intentos configurable en tabla (5 por defecto), backoff exponencial y recuperación de leases vencidos. El worker arranca solo si el storage HTTPS está configurado.
- Aún faltan antivirus/aislamiento, limpieza programada de objetos huérfanos y cargas abandonadas, cuotas, multipart/resume, endpoint de descarga con autorización, integración automática con timeline y pruebas end-to-end contra un bucket real.
- El worker permanece inactivo hasta configurar un bucket privado HTTPS y credenciales de mínimo privilegio. El código de procesamiento ya está incorporado, pero todavía no se ha probado con un proveedor real.
- Las URL firmadas se entregan solo a usuarios autenticados; la entrega/descarga de medios todavía requiere un endpoint de autorización propio.


La migración `0004_media_declared_metadata.sql` separa explícitamente `mime_type_declared`/`checksum_sha256_declared` de `mime_type_detected`/`checksum_sha256`; al iniciar la carga, el MIME detectado queda como `application/octet-stream` y el hash verificado como marcador no válido para publicación hasta el procesamiento.


La migración `0005_media_processing_queue.sql` crea una cola durable única por asset, con disponibilidad diferida, intentos máximos, lease de worker, estado de error e índices parciales para jobs listos y leases activos.
