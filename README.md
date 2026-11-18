# MOMENTIA

MOMENTIA es una plataforma móvil y web para capturar, organizar, compartir y revivir recuerdos mediante experiencias sociales, privadas y colaborativas.

## Experiencias del producto

1. **Social:** perfiles, publicaciones, feed, seguidores/conexiones, reacciones y comentarios.
2. **Eventos y grupos:** álbumes colaborativos para bodas, cumpleaños, campamentos, viajes, reuniones y eventos empresariales; invitación por QR/enlace y galería cronológica.
3. **Parejas:** espacio privado para dos personas, diario fotográfico, recuerdos y fechas especiales.
4. **Círculos privados:** espacios cerrados para familia y amistades, con miembros, roles, álbumes y permisos.
5. **Social Audio:** sesiones musicales grupales con cola colaborativa y reproducción coordinada en dispositivos participantes, usando fuentes y derechos autorizados.

## Principios técnicos

- Android e iOS con una base de código compartida.
- PWA complementaria para invitados de eventos.
- Diseño offline-first: operaciones locales cuando no hay conexión y sincronización posterior.
- Privacidad por espacio y por contenido.
- Arquitectura modular, contratos explícitos, pruebas y observabilidad.
- Almacenamiento de originales separado de metadatos y derivados.

## Documentación

- [Visión y alcance](docs/00-vision-y-alcance.md)
- [Requisitos funcionales](docs/01-requisitos-funcionales.md)
- [Arquitectura técnica](docs/02-arquitectura-tecnica.md)
- [Modelo de dominio y datos](docs/03-modelo-dominio-y-datos.md)
- [API y tiempo real](docs/04-api-y-tiempo-real.md)
- [Offline, sincronización y multimedia](docs/05-offline-sync-y-multimedia.md)
- [Seguridad y privacidad](docs/06-seguridad-y-privacidad.md)
- [Social Audio](docs/07-social-audio.md)
- [Roadmap y calidad](docs/08-roadmap-y-calidad.md)
- [Decisiones pendientes](docs/09-decisiones-pendientes.md)

## Stack de referencia

- Mobile: React Native, Expo Development Build y TypeScript.
- Web invitado: PWA con TypeScript.
- Backend: NestJS y Node.js.
- Datos: PostgreSQL.
- Cache/colas: Redis y BullMQ.
- Multimedia: object storage compatible con S3; Cloudflare R2 es candidato.
- Tiempo real: WebSockets.
- Push: Expo Push Notifications inicialmente, con APNs/FCM en la ruta de entrega.

Las decisiones de proveedor, versiones, costos, límites de SDK y licencias se validarán antes de producción.

## Estado

La API NestJS y la primera base de la app móvil Expo/React Native están en desarrollo en esta rama. La app móvil aún no está lista para instalar ni para producción. La PWA de invitados, sincronización offline efectiva, autenticación UI completa y pruebas nativas siguen pendientes. Los porcentajes de desarrollo solo se actualizarán con entregables y pruebas verificables.
