# 00. Visión y alcance

**Versión:** 1.0 · **Estado:** línea base funcional propuesta.

## Visión
MOMENTIA permite capturar, organizar, compartir y conservar recuerdos en experiencias sociales, colaborativas y privadas. Cinco experiencias comparten una cuenta y servicios centrales, pero mantienen permisos y audiencias aislados.

## Experiencias
1. **Social:** perfiles, publicaciones, feed, seguidores/conexiones, reacciones, comentarios, bloqueo, reportes y descubrimiento sujeto a privacidad.
2. **Eventos y grupos:** bodas, cumpleaños, viajes, campamentos, fiestas, reuniones y eventos empresariales; anfitrión, participantes, QR/enlaces, álbum colaborativo, cronología, moderación y descarga autorizada.
3. **Parejas:** espacio privado para dos personas, diario fotográfico, entradas cotidianas, recuerdos y aniversarios.
4. **Círculos privados:** espacios cerrados para familia y amistades, con miembros, roles, álbumes y permisos.
5. **Social Audio:** sesiones musicales grupales vinculadas a un espacio, con cola colaborativa y reproducción coordinada desde fuentes autorizadas.

## Capacidades transversales
- Registro, autenticación, perfil, sesiones y preferencias.
- Cámara, galería, selección múltiple y gestión multimedia.
- Originales y derivados optimizados; metadatos de captura y cronología.
- Operación local offline y cola persistente de sincronización.
- PWA complementaria para invitados de eventos.
- Notificaciones, moderación, administración, métricas y monetización.
- Seguridad, auditoría, exportación, eliminación y soporte.

## Roles
Visitante, invitado, usuario, miembro, anfitrión/propietario, moderador y administrador de plataforma. Los roles son contextuales: administrar un evento no concede acceso a otros espacios.

## Principios no negociables
1. Privacidad por defecto y audiencia explícita por contenido.
2. Aislamiento entre perfil social, evento, pareja y círculo.
3. Consentimiento para ubicación, contactos y notificaciones.
4. Mostrar estados reales: local, pendiente, subiendo, procesando, sincronizado o fallido.
5. Distinguir hora de captura, subida, publicación y sincronización.
6. Autorización en servidor; la UI no es una barrera de seguridad.
7. Arquitectura modular, accesible, observable y probada.
8. Licencias adecuadas para música y cualquier contenido de terceros.

## Límites explícitos
- No se garantiza sincronización acústica perfecta ni sustitución de un sistema de sonido profesional.
- No se promete ejecución ilimitada en segundo plano: iOS y Android imponen restricciones.
- Sin conexión no existe sincronización remota; solo operaciones locales y, si se construye aparte, comunicación LAN.
- No se redistribuye música protegida ni se eluden DRM o términos de proveedores.
- GPS es opcional y desactivado por defecto.
- No se habilita contenido de menores sin definir edad mínima, consentimiento y obligaciones legales.

## Medición
El alcance acordado equivale al 100% de la línea base funcional, no al progreso de desarrollo. Cada requisito tendrá estado y evidencia. Un módulo solo se considera terminado tras cumplir criterios de aceptación y pruebas.
