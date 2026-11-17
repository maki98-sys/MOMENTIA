# 08. Roadmap, pruebas y calidad

## Estrategia
Construcción vertical: cada fase entrega un flujo completo, probado y demostrable. No medir avance por número de pantallas o archivos.

## Fases
0. **Base técnica:** decisiones, repositorio, CI, entornos, secretos, convenciones, ADR y modelo de amenazas.
1. **Identidad y espacios:** registro, perfil, sesiones, roles, membresía, QR/enlace y aislamiento.
2. **Motor multimedia:** cámara/galería, selección múltiple, validación, EXIF, originales/derivados, carga y galería.
3. **Offline-first:** base local, cola persistente, reintentos, reanudación, conflictos y pruebas de red.
4. **Eventos, parejas y círculos:** reglas por espacio, diarios, álbumes, PWA invitado, reportes y ZIP.
5. **Social:** perfiles, feed, conexiones, comentarios, reacciones, bloqueo y moderación.
6. **Notificaciones y Social Audio:** preferencias push, sesiones, cola, sincronización y fuente musical autorizada.
7. **Administración y monetización:** panel, auditoría, planes, cuotas, pagos y webhooks.
8. **Hardening y publicación:** rendimiento, accesibilidad, seguridad, backups, revisión legal/tiendas, beta y despliegue gradual.

## Pirámide de pruebas
- Unitarias: dominio, permisos, sincronización y estados.
- Integración: API, PostgreSQL, Redis, objetos y colas.
- Contrato: OpenAPI, DTO y eventos.
- E2E: registro, invitación, publicación, subida y moderación.
- UI móvil: Android/iOS reales y emuladores.
- Offline: modo avión, pérdida intermitente, reinicio y cierre forzado.
- Seguridad: BOLA/IDOR, abuso, rate limits, archivos y sesiones.
- Carga: feed, álbumes, subida concurrente, WebSockets y audio.
- Accesibilidad: lector de pantalla, contraste, texto, foco y navegación.

## Puertas de calidad
Un módulo pasa a terminado solo si: requisitos trazables implementados; migraciones/rollback probados; autorización server-side; pruebas verdes; estados vacíos/error diseñados; logs sin datos sensibles; documentación actualizada; prueba manual en plataformas requeridas; evidencia de aceptación.

## Avance
Registrar por requisito estado, responsable, PR/commit, pruebas, evidencia y fecha. Calcular porcentaje por peso de requisitos aceptados. Reportar bloqueos y dependencias aparte.

## Riesgos prioritarios
Costos de almacenamiento/egress; licencias musicales; restricciones background; EXIF/GPS y menores; abuso de enlaces; conectividad débil; pagos/tiendas por país; dispositivos antiguos y batería.

## Definición de terminado global
Cumplir alcance, seguridad, rendimiento, recuperación operacional, políticas, soporte, publicación y proceso de actualización/monitoreo.
