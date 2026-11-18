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
6. El servidor realiza HEAD al objeto privado y compara tamaño y Content-Type antes de marcar la transferencia como recibida.

Las URLs firmadas son temporales. El endpoint de finalización exige que la carga y el asset pertenezcan al usuario autenticado.

## Limitaciones explícitas de esta fase

- El MIME y SHA-256 enviados al iniciar la carga son declaraciones del cliente. Al completar, el servidor descarga el objeto privado (máximo 25 MiB), inspecciona firmas binarias JPEG/PNG/WebP y recalcula SHA-256. Si MIME real o hash no coinciden, marca el asset como `quarantined` y la carga como `failed`. Los campos verificados solo se actualizan cuando ambas comprobaciones coinciden.
- Tras verificar bytes y hash, el asset permanece `pending`: todavía no existe decodificación segura, eliminación EXIF/GPS, generación de variantes ni publicación automática en timeline. No se marca como `ready`.
- Aún faltan worker de procesamiento, decodificación segura con límites de dimensiones/píxeles, eliminación EXIF/GPS, variantes, antivirus/aislamiento, reanudación multipart, limpieza de cargas abandonadas, cuotas y pruebas end-to-end con proveedor real.
- El servicio no se activa hasta configurar un bucket privado y credenciales de mínimo privilegio.
- Las URL firmadas se entregan solo a usuarios autenticados; la entrega/descarga de medios todavía requiere un endpoint de autorización propio.


La migración `0004_media_declared_metadata.sql` separa explícitamente `mime_type_declared`/`checksum_sha256_declared` de `mime_type_detected`/`checksum_sha256`; al iniciar la carga, el MIME detectado queda como `application/octet-stream` y el hash verificado como marcador no válido para publicación hasta el procesamiento.
