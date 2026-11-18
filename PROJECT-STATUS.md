# MOMENTIA — Control maestro de desarrollo

**Versión:** 1.1  
**Repositorio:** `maki98-sys/MOMENTIA`  
**Rama de trabajo:** `docs/arquitectura-y-alcance-v1`  
**Estado:** base de datos en revisión final; backend con dominios API parciales y Social Audio inicial; CI de API y migraciones en nueva verificación; frontend móvil/PWA aún no iniciado.

> Este archivo es la fuente única del avance. Los porcentajes se actualizan solo cuando existe código, pruebas y evidencia verificable. Documentar una función no significa que esté programada.

## 1. Reglas de ejecución

- El objetivo es entregar la aplicación completa, no solo especificaciones.
- El trabajo se ejecuta por fases y módulos, con commits pequeños y comprobables.
- Orden de ejecución vigente: base de datos → backend → frontend → offline/sincronización → integración y calidad. Los contratos se diseñan temprano; la persistencia PostgreSQL se establece antes de construir servicios que dependan de ella.
- Ninguna fase se marca completa por haber creado archivos: requiere implementación, pruebas y criterios de aceptación.
- No se fusiona a `main` sin revisión de cambios y comprobaciones.
- No se inventa avance. Los porcentajes se basan en tareas aceptadas, no en estimaciones optimistas.
- El trabajo que requiera credenciales, secretos, cuentas de proveedores, dispositivos físicos, publicación o aprobación legal se identifica como dependencia externa; se prepara todo lo que pueda hacerse sin esas acciones.

## 2. Distribución global de avance

Los pesos acordados suman 100%.

| Fase | Peso global | Alcance | Avance inicial |
|---|---:|---|---:|
| 0. Arquitectura y especificación | 8% | alcance, requisitos, diagramas, decisiones, contratos y estructura | 0% aceptado |
| 1. Modelo y diseño de datos | 8% | modelo relacional, migraciones, índices, reglas y datos locales | 90% provisional, pendiente de CI actual |
| 2. Backend | 22% | API, autenticación, dominios, permisos, workers y tiempo real | 8% verificado |
| 3. Frontend móvil y web | 20% | Android/iOS, navegación, pantallas, estados y PWA | 0% |
| 4. Offline y sincronización | 14% | SQLite, cola local, reintentos, conflictos y cargas | 0% |
| 5. Integración end-to-end | 10% | conexión completa, notificaciones, storage y proveedores | 0% |
| 6. Calidad y seguridad | 12% | pruebas, hardening, rendimiento, accesibilidad y recuperación | 0% |
| 7. Lanzamiento | 6% | builds, beta, tiendas, despliegue, monitoreo y soporte | 0% |
| **Total** | **100%** | | **8.96% global verificado** |

La documentación fundacional inicial ya está escrita en `docs/`; se considera un borrador de partida, no una fase aceptada ni código terminado. Se revisará y ampliará durante la Fase 0.

## 3. Módulos y pesos internos

Los pesos de esta tabla se usan para distribuir el avance dentro de cada fase; no se suman nuevamente al porcentaje global.

### Fase 0 — Arquitectura (8% global)
- Visión, alcance y requisitos: 20% de la fase.
- Arquitectura de software y estructura de repositorio: 20%.
- Contratos API y eventos: 20%.
- Seguridad, privacidad y amenazas: 15%.
- ADR y decisiones de proveedores: 10%.
- Plan de pruebas y criterios de aceptación: 15%.

### Fase 1 — Datos (8% global)

**Avance verificado actual: 90% de la fase (7.2% del proyecto).** Desglose ponderado y conservador:
- Modelo relacional y restricciones: 95% (esquema base, tablas operativas y reglas principales implementadas; falta revisión final de cobertura).
- Migraciones y seeds: 95% (siete migraciones aplicadas en el último intento; runner idempotente; verificación del ledger se está corrigiendo para contar archivos de migración dinámicamente).
- Índices, consultas y paginación: 85% (índices y consultas representativas con EXPLAIN verificados; smoke test sintético de 10.000 entradas y consulta latest-50 completado; falta carga representativa prolongada y ajuste fino).
- Persistencia local SQLite: 85% (esquema y smoke tests pasan; falta política de cifrado/versionado y uso desde la app).
- Retención, exportación y borrado: 70% (tablas y estados de solicitud implementados; los plazos se mantienen desactivados hasta aprobación legal y la ejecución corresponde al backend).
- Pruebas de integridad y migración: 90% (CI PostgreSQL 16 previo pasó integridad, concurrencia, SQLite, seeds, EXPLAIN, backup/restore y smoke test; la última migración 0007 ya se aplicó, pero el chequeo de ledger falló por expectativa fija de seis y se actualizó el workflow para calcular el número de archivos; nueva ejecución pendiente).

- Modelo relacional y restricciones: 25%.
- Migraciones y seeds: 20%.
- Índices, consultas y paginación: 15%.
- Persistencia local y esquema SQLite: 15%.
- Retención, exportación y borrado: 10%.
- Pruebas de integridad y migración: 15%.

### Fase 2 — Backend (22% global)
- Base NestJS, configuración y observabilidad: 8%.
- Identidad, autenticación y sesiones: 12%.
- Usuarios y perfiles: 5%.
- Espacios, membresías, roles e invitaciones: 12%.
- Eventos, álbumes y parejas/círculos: 10%.
- Multimedia, cargas y procesamiento: 12%.
- Social: publicaciones, feed, comentarios y reacciones: 10%.
- Timeline y consultas: 5%.
- Notificaciones: 5%.
- Social Audio y coordinación de sesiones: 8%.
- Moderación, reportes y administración: 5%.
- Billing/cuotas y webhooks: 3%.
- API docs, pruebas y hardening backend: 5%.

### Fase 3 — Frontend (20% global)
- Base de app, navegación, tema y componentes: 10%.
- Registro, login y recuperación: 8%.
- Perfil y ajustes: 5%.
- Inicio/feed social: 10%.
- Crear/capturar/seleccionar fotos: 10%.
- Eventos, invitaciones y álbumes: 12%.
- Parejas y diario privado: 8%.
- Círculos privados: 6%.
- Timeline, galería y visor: 8%.
- Social Audio: 7%.
- Notificaciones y preferencias: 4%.
- PWA para invitados: 5%.
- Accesibilidad, estados, errores y UI responsive: 7%.

### Fase 4 — Offline (14% global)
- Base local y almacenamiento seguro: 15%.
- Cola persistente de operaciones: 20%.
- Cola de cargas multimedia y reanudación: 20%.
- Reintentos, backoff y gestión de conectividad: 10%.
- Resolución de conflictos y permisos revocados: 15%.
- Sincronización incremental y cursores: 10%.
- Caché, limpieza y pruebas modo avión: 10%.

### Fase 5 — Integración (10% global)
- App ↔ API y contratos: 20%.
- API ↔ PostgreSQL/Redis: 20%.
- API ↔ object storage y workers: 15%.
- WebSockets y presencia: 10%.
- Push y enlaces profundos/QR: 10%.
- Integración Social Audio con proveedor autorizado: 10%.
- Pagos/email y otros proveedores elegidos: 5%.
- Pruebas end-to-end en entornos integrados: 10%.

### Fase 6 — Calidad y seguridad (12% global)
- Pruebas unitarias/integración/contrato: 20%.
- E2E y pruebas en Android/iOS: 15%.
- Autorización, BOLA/IDOR y sesiones: 15%.
- Seguridad multimedia y privacidad/EXIF: 10%.
- Rendimiento, carga y consumo de datos/batería: 10%.
- Accesibilidad y compatibilidad: 10%.
- Logs, métricas, alertas y monitoreo: 8%.
- Backups, restauración y respuesta a incidentes: 7%.
- Revisión legal y políticas de publicación: 5%.

### Fase 7 — Lanzamiento (6% global)
- Entornos y despliegue backend: 20%.
- Builds firmados Android/iOS: 20%.
- Beta, pruebas de aceptación y correcciones: 20%.
- Fichas de tienda, privacidad y publicación: 15%.
- Monitoreo, soporte y rollback: 15%.
- Documentación operativa y entrega: 10%.

## 4. Estado de módulos de producto

| Módulo | Estado de implementación | Avance |
|---|---|---:|
| Cuenta, identidad y perfiles | API parcial: OIDC, perfil y cuenta | En verificación |
| Espacios, roles e invitaciones QR/enlace | API parcial: espacios, membresías e invitaciones | En verificación |
| Eventos y álbumes colaborativos | API parcial: álbumes y elementos; falta experiencia móvil | En verificación |
| Parejas y diario privado | API parcial: diario cifrado; falta flujo de consentimiento y cliente | En verificación |
| Círculos privados | API existente mediante espacios, membresías, invitaciones, álbumes y timeline; pruebas adicionales de roles incorporadas | En verificación |
| Red social, feed e interacciones | API parcial: publicaciones, comentarios, reacciones y feed | En verificación |
| Cámara, galería, EXIF y multimedia | API parcial: carga y procesamiento; falta captura móvil | En verificación |
| Timeline y recuerdos | API parcial: consultas y escritura de timeline | En verificación |
| Offline y sincronización | Esquema SQLite y outbox; falta motor móvil | Pendiente |
| Social Audio | API inicial de sesiones, participantes, cola, votación y control host; CI API #44238927772 verde; nueva verificación tras ajuste de índice parcial pendiente; faltan WebSocket, heartbeat, SDK/proveedor autorizado y app móvil | En verificación |
| Notificaciones | API de bandeja, lectura individual/masiva y paginación; ejecución API #44238927772 pasó typecheck, unit tests, build y Docker; CI posterior tras ajuste sigue pendiente | En verificación |
| PWA de invitados | No iniciado | 0% |
| Moderación y administración | Esquema de datos; falta API y flujos | Pendiente |
| Monetización y cuotas | Esquema de datos; faltan billing core y proveedores | Pendiente |

## 5. Estructura de carpetas objetivo

La estructura se ajustará al contenido real del repositorio antes de crearla; no se sobrescribirán archivos existentes sin inspección.

```text
MOMENTIA/
├── apps/
│   ├── mobile/                 # React Native / Expo
│   └── guest-web/              # PWA para invitados
├── services/
│   └── api/                    # NestJS
├── packages/
│   ├── contracts/              # DTO, esquemas y tipos compartidos
│   ├── config/                 # configuración compartida
│   └── ui/                     # componentes reutilizables si aplica
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── local/                  # esquema SQLite y evolución local
├── infra/
│   ├── docker/
│   ├── ci/
│   └── deploy/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── security/
│   ├── modules/
│   └── operations/
├── tests/
│   ├── e2e/
│   ├── contract/
│   └── performance/
├── .github/
│   └── workflows/
└── PROJECT-STATUS.md
```

## 6. Criterio de avance

Una tarea se contabiliza como terminada únicamente si:
1. El código está en la rama de trabajo y tiene commit.
2. Compila o ejecuta en el entorno definido.
3. Tiene pruebas pertinentes y pasan.
4. Los permisos y errores están cubiertos.
5. La documentación y criterios de aceptación están actualizados.
6. Existe evidencia reproducible (log CI, prueba, captura o instrucciones verificadas).

**Fórmula:** avance de fase = suma de pesos internos de tareas aceptadas.  
**Avance global = suma de (peso global de fase × avance de fase).**

## 7. Registro de entregas

| Fecha | Entrega | Commit/PR | Pruebas | Estado |
|---|---|---|---|---|
| 2026-11-17 | Documentación fundacional v1 creada en rama de documentación | Ver historial de rama | No aplica a implementación | Borrador documental |
| 2026-11-17 | Base PostgreSQL y SQLite, tres migraciones, restricciones, seeds, consultas y respaldo/restauración | GitHub Actions run #32: success | PostgreSQL 16, SQLite, integridad, concurrencia, EXPLAIN y restore | Verificado |
| 2026-11-17 | Runner de migraciones con ledger e idempotencia | GitHub Actions run #28: success | Aplicación inicial y segunda ejecución sin duplicar cambios | Verificado |
| 2026-11-17 | Inventario de 41 tablas servidor y 10 tablas locales | database/SCHEMA.md | Revisión del esquema y límites de responsabilidad | Documentado |
| 2026-11-17 | Casos negativos de subtipo incompatible y álbum en CIRCLE | GitHub Actions run #32: success | Las dos restricciones rechazan los registros inválidos | Verificado |
| 2026-11-17 | Prueba sintética de 10.000 entradas de cronología y consulta indexada | GitHub Actions run #35: success | Conteo 10.000, índice `timeline_entries_space_time_idx`, consulta latest-50 en 0.023 ms; transacción revertida | Verificado |
| 2026-11-17 | Auditoría automática de columnas SQLite para evitar secretos de autenticación | GitHub Actions run #36: success | Rechaza columnas con nombres token/secret/password/credential/authorization | Verificado |\n| 2026-11-18 | Bootstrap NestJS aceptado: migraciones, typecheck, unit tests, build y Docker | GitHub Actions run #7, commit `d33dfa4` | Todos los pasos completados correctamente | Verificado |\n| 2026-11-18 | ADR-001: estrategia de identidad y autenticación propuesta, pendiente de decisión | `docs/architecture/ADR-001-identity-and-authentication.md` | Revisión de tablas users/auth_identities/auth_sessions y límites de seguridad | Propuesta; no implementada |

## 8. Cierre de Fase 1 y siguiente ejecución

La Fase 1 permanece abierta hasta completar:
1. Revisión final de cobertura de relaciones y restricciones de todas las entidades.
2. Prueba sintética de 10.000 entradas de cronología y consulta latest-50: completada en run #35; el índice esperado fue utilizado. La prueba es un smoke test de carga, no sustituye pruebas de estrés/concurrencia a escala de producción.
3. Revisión de los límites de privacidad y de las operaciones de exportación/eliminación que implementará el backend; los plazos de retención siguen desactivados hasta aprobación legal por mercado.
4. Auditoría automática de columnas SQLite contra nombres de secretos: completada en run #36. El cifrado de archivos locales y la custodia real de credenciales en Keychain/Keystore se implementarán y probarán en las fases móvil/offline.

La Fase 1 sigue en revisión final. El bootstrap del backend ya se ejecutó en paralelo como base técnica y fue aceptado por CI. La siguiente ejecución backend será definir la estrategia de identidad/autenticación y después implementar dominios con autorización comprobable. No se implementará lógica que dependa de una política de retención no aprobada.

**No declarar la aplicación creada hasta tener una versión ejecutable y comprobada en dispositivos/emuladores.**


## 9. Inicio de implementación del backend

**Estado: base técnica creada y aceptada por CI en el HEAD de la rama de trabajo.**

Entregables añadidos:
- Servicio NestJS modular en `services/api`, con TypeScript y configuración validada mediante Joi.
- Pool PostgreSQL administrado por el ciclo de vida de NestJS.
- Endpoints `GET /api/v1/health/live` y `GET /api/v1/health/ready`; readiness ejecuta `SELECT 1` y devuelve 503 si PostgreSQL no responde.
- Seguridad HTTP inicial con Helmet, CORS denegado por defecto y ValidationPipe global.
- Pruebas unitarias de validación de entorno.
- Dockerfile multi-stage con ejecución como usuario no root.
- Workflow `.github/workflows/api-check.yml` que aplica migraciones, instala dependencias, ejecuta typecheck, pruebas, build y build de imagen Docker.

Límites deliberados de esta entrega:
- No se exponen todavía rutas de cuenta, perfiles ni espacios.
- No se ha elegido proveedor de identidad ni se inventará almacenamiento de contraseñas: el esquema actual no contiene hash de contraseña y la decisión de autenticación debe preceder a su implementación.
- No se han activado retención, borrado automático ni políticas de conservación.
- Observabilidad avanzada, trazas, métricas y alertas quedan pendientes.

La aceptación del bootstrap quedó verificada en GitHub Actions run #7 (commit `d33dfa44732f0e44cea3d66ebd9c7ff8ad666c50`): migraciones PostgreSQL, instalación, typecheck, pruebas unitarias, build y build de imagen Docker finalizaron correctamente. Se contabiliza únicamente el 8% de la Fase 2 correspondiente al bootstrap; no se contabilizan aún módulos funcionales. La decisión de proveedor/protocolo de identidad está documentada en ADR-001 y sigue pendiente de aprobación.


## 2026-11-18 — OIDC foundation (in progress)
- User approved managed OIDC as the identity strategy; concrete provider remains unselected.
- Added provider-neutral issuer/audience/JWKS configuration, HTTPS-only OIDC endpoints, JOSE JWT verification with RS256/ES256 allowlist, bearer guard and principal contract.
- Added configuration tests and bearer-guard unit tests; AuthModule is registered but guard is not global and no private product routes are exposed.
- Added implementation boundary and integration sequence in `services/api/src/auth/README.md`.
- CI run #44210416238 was queued at the time of this update; do not count this work as accepted until CI is green. Account mapping, MOMENTIA sessions, refresh rotation, revocation and resource authorization remain unimplemented.


## 10. Actualización de implementación — 2026-11-18

Esta sección corrige el inventario inicial de módulos del apartado 4, que quedó desactualizado cuando avanzó la implementación backend.

### Estado comprobado en la rama de trabajo
- Repositorio: `maki98-sys/MOMENTIA`.
- Rama: `docs/arquitectura-y-alcance-v1`.
- La rama `main` no contiene todavía este desarrollo; no fusionar automáticamente.
- La estructura contiene `services/api`, `database` y `docs`; no existe aún `apps/mobile`, `apps/guest-web` ni `packages`.
- El backend incluye módulos NestJS para health, auth, profile, spaces, invitations, memberships, social, timeline, albums, media y couple-journal.
- La base de datos contiene seis migraciones PostgreSQL y un esquema SQLite local de 10 tablas.
- La API usa guard OIDC y resolución de identidad; la decisión final del proveedor de identidad sigue pendiente.
- El módulo couple-journal almacena ciphertext y nonce, no texto plano; la gestión de claves y cifrado del lado cliente siguen pendientes.
- El módulo de notificaciones incluye bandeja por usuario, filtro de no leídas, marcar una/todas como leídas y cursor estable por fecha + UUID. La API fue incluida en los workflows de backend; el CI de la rama se sigue verificando tras los últimos commits.
- CI API #44238927772 terminó correctamente: migraciones, typecheck, unit tests, build y Docker. La ejecución de base de datos #44238922792 falló únicamente en el conteo fijo del ledger (esperaba 6, había 7); el workflow se corrigió para comparar contra el número de archivos de migración. La nueva ejecución #44239290972 está pendiente.

### Siguiente orden de trabajo
1. Cerrar CI del módulo de notificaciones y corregir cualquier fallo.
2. Actualizar y auditar contratos/autorización de los dominios existentes.
3. Implementar backend de eventos/círculos y Social Audio con pruebas de permisos.
4. Definir e implementar sincronización y notificaciones push.
5. Crear la aplicación React Native/Expo Android+iOS y conectar contratos reales.
6. Implementar SQLite cifrado, outbox, reintentos y sincronización incremental en el cliente.
7. Construir PWA de invitados y completar pruebas end-to-end.

No se asigna un nuevo porcentaje global hasta recalcular las tareas ponderadas y aceptar las pruebas de esta entrega.


### Actualización adicional — círculos y control de membresías
- Se verificaron las rutas existentes para crear y consultar círculos, administrar miembros, invitar, aceptar invitaciones, álbumes y cronología.
- Se documentó el contrato en `docs/06-circles-and-memberships.md`.
- Se añadieron pruebas unitarias para acceso de miembros, jerarquía de roles, prevención de autoexpulsión y restricciones del propietario.
- La nueva suite se encuentra pendiente de CI. La transferencia de propiedad, solicitudes de ingreso/aprobación, moderación y cliente móvil siguen pendientes.


### Actualización — Social Audio y CI de migraciones (2026-11-18)
- Se creó y registró `AudioModule`: creación/consulta de sesiones, entrada/salida, cola de pistas por referencia externa, votaciones y control de reproducción exclusivo del anfitrión.
- Se añadió `audio.service.spec.ts` con validación de identificadores/proveedores, control de anfitrión y votos inválidos.
- Se añadió migración `0007_audio_participant_uniqueness.sql` con índice único parcial para participantes sin dispositivo.
- El CI API #44238927772 terminó correctamente (migraciones, typecheck, pruebas unitarias, build y Docker). Después se ajustó el target de conflicto SQL para usar el índice parcial; el workflow API #44239313944 está pendiente de resultado.
- El CI de base de datos #44238922792 falló porque el workflow esperaba exactamente seis migraciones aunque ya existían siete. Se corrigió el chequeo para calcular el total desde los archivos SQL; #44239290972 está pendiente.
- La documentación del contrato y límites está en `docs/07-social-audio-api.md`.
- Social Audio aún no transmite música ni sincroniza audio real entre teléfonos: faltan WebSocket, heartbeat, cliente móvil y SDK/proveedor con derechos de reproducción.


## 2026-11-18 — Actualización de verificación y presencia Social Audio

- CI de base de datos #44239437698: **success** en commit `4a089cbc718d30f4be7253aae2b17d365ea00d68`. Pasaron migraciones, idempotencia, ledger, integridad, seeds, planes de consulta, smoke test de 10.000 entradas, backup/restore, SQLite y concurrencia COUPLE.
- CI API #44239437933: **success** en el mismo commit. Pasaron migraciones, typecheck, unit tests, build y contenedor Docker de producción.
- Se corrigió el test de backup/restore para comparar el ledger con el número real de archivos SQL, en lugar de fijarlo a seis.
- Social Audio: agregado `POST /audio-sessions/:sessionId/heartbeat`. Solo renueva presencia cuando la sesión está activa, el participante no ha salido y la membresía del espacio sigue activa. No incrementa la versión de playback.
- Se añadieron pruebas unitarias de heartbeat válido y participación inactiva.
- CI API #44239760139 está **in_progress** para el commit `9cec1022e5f1aada7060133fb854271f6c125eea`; todavía no se contabiliza como aprobado.
- La presencia sigue siendo REST. WebSockets, reconexión automática, timeout/limpieza de participantes y sincronización real entre clientes siguen pendientes. La API no transporta audio ni inicia reproducción musical en dispositivos.

## 2026-11-18 — Social Audio realtime gateway

- API CI #44239760139 aprobó el heartbeat REST y sus pruebas: **success** (commit `9cec1022e5f1aada7060133fb854271f6c125eea`).
- Se añadieron dependencias NestJS WebSockets / Socket.IO al manifiesto de API.
- Se creó namespace `/audio` con transporte WebSocket y autenticación OIDC en el handshake.
- Eventos de sesión: unirse, salir, heartbeat, snapshot y errores. El gateway verifica la membresía antes de unir un socket a una sala.
- Los cambios de playback, cola, votos y participantes hechos por REST publican snapshots a los sockets conectados.
- CI de esta implementación todavía debe ejecutarse y aprobarse.
- Límite: difusión en memoria para una instancia. Redis adapter, limpieza de presencia al desconectar/expirar, cliente móvil y SDK de música siguen pendientes.

- Primera validación del gateway detectó un error de tipado en el snapshot (`server_version`); se amplió el tipo de retorno de `withQueue` y se corrigió la importación de interfaces de ciclo de vida NestJS.
- Las ejecuciones intermedias fueron canceladas por los nuevos commits (concurrency `cancel-in-progress`). La validación más reciente #44240792982 está en cola; no se declara aprobada todavía.
