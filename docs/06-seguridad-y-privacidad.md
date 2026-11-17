# 06. Seguridad y privacidad

## Amenazas
Acceso cruzado a fotos (BOLA/IDOR), robo de sesión, QR reenviado, fuerza bruta, archivos maliciosos, EXIF/GPS expuesto, abuso de invitaciones/audio, secretos filtrados, escalada administrativa, webhooks falsos y acceso interno excesivo.

## Identidad y sesiones
- Hash de contraseña con algoritmo adaptativo moderno o proveedor confiable.
- MFA para administración; MFA de usuario según riesgo.
- Access tokens breves y refresh rotatorios/revocables.
- Keychain/Keystore; nunca guardar credenciales en texto plano.
- Gestión de dispositivos y revocación.
- Rate limiting y respuestas que eviten enumeración.

## Autorización
Denegar por defecto; verificar cada recurso en backend. Roles por tipo de espacio y acción. Invitaciones con tokens de alta entropía, hash en reposo, expiración, usos máximos y revocación. URLs firmadas cortas. Bloqueos y revocaciones deben aplicarse en nuevas lecturas y conexiones.

## Archivos
Validar extensión, MIME detectado, firma mágica, tamaño, dimensiones y decodificación. Procesar en cuarentena/worker aislado con límites de CPU, memoria y tiempo. No ejecutar archivos subidos. Eliminar EXIF sensible de derivados.

## Consentimiento y minimización
Ubicación desactivada por defecto y opt-in. Informar metadatos recogidos. Controlar atribución y vistas previas push. Contactos solo con permiso. Estados de ánimo opcionales y privados al espacio. Recoger lo mínimo necesario.

## Cifrado y secretos
TLS, cifrado en reposo, gestión de claves, cifrado de campos sensibles cuando aplique. Secretos en gestor dedicado y fuera de Git. Rotación, mínimo privilegio, escaneo de dependencias y secretos en CI. Logs sin tokens, URLs firmadas, EXIF ni contenido privado.

## Moderación
Reportar usuario/post/comentario/espacio; bloquear y silenciar; flujos de revisión, apelación y auditoría; límites anti-spam. Definir edad mínima y obligaciones sobre menores antes de lanzamiento público.

## Administración
RBAC interno separado de roles de usuarios, MFA, acceso de soporte limitado y justificado, audit log de cambios sensibles, alertas de anomalías.

## Cumplimiento e incidentes
Revisión legal para mercados objetivo: protección de datos, derechos de imagen, menores, transferencias internacionales, retención, exportación, eliminación, cookies, términos y privacidad. Definir respuesta a incidentes, responsables, severidad, contención, comunicación, recuperación, RTO/RPO y pruebas de restauración. La documentación técnica no sustituye asesoría legal.
