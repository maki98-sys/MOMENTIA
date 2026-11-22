# MOMENTIA — Control maestro de desarrollo

**Versión:** 1.1  
**Repositorio:** `maki98-sys/MOMENTIA`  
**Rama de trabajo:** `docs/arquitectura-y-alcance-v1`  
**Estado al 2026-11-18:** backend modular parcial; aplicación Expo móvil con captura y subida manual de fotografías; sincronización offline, experiencia de producto y lanzamiento todavía incompletos.

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

Los pesos globales suman 100%. El porcentaje se recalculó el 2026-11-18 con evidencia de código y CI, y es una estimación ponderada conservadora: una fase parcial no equivale a producto listo para usuarios.

| Fase | Peso global | Avance estimado de fase | Aporte global |
|---|---:|---:|---:|
| 0. Arquitectura y especificación | 8% | 35% | 2.80% |
| 1. Modelo y diseño de datos | 8% | 90% | 7.20% |
| 2. Backend | 22% | 42% | 9.24% |
| 3. Frontend móvil y web | 20% | 12% | 2.40% |
| 4. Offline y sincronización | 14% | 10% | 1.40% |
| 5. Integración end-to-end | 10% | 20% | 2.00% |
| 6. Calidad y seguridad | 12% | 15% | 1.80% |
| 7. Lanzamiento | 6% | 0% | 0.00% |
| **Total global ponderado** | **100%** | | **26.84% ≈ 27%** |

**Cómo interpretar el 27%:** representa el avance del trabajo técnico ponderado, no una aplicación terminada ni un porcentaje de funcionalidades disponibles para el público. La mayor parte del avance está en datos y backend. El frontend sigue siendo temprano: existe navegación base, captura y subida manual, pero no hay todavía feed funcional conectado ni flujos completos de las cinco experiencias.

**Criterio:** el avance de cada fase se estima a partir de entregables presentes, cobertura funcional y evidencia de pruebas. Los módulos documentados, pendientes de proveedor o sin prueba se mantienen parciales o en cero. La cifra se recalculará cuando nuevas entregas pasen CI.

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

## 2026-11-18 — Primera base de aplicación móvil

- Creada `apps/mobile` con React Native, Expo SDK 54, TypeScript y Expo Router.
- Añadida pantalla inicial que comprueba la API `/health` y la inicialización de SQLite.
- Añadido cliente HTTP centralizado con Bearer token y errores tipados.
- Añadido almacenamiento de token con Expo SecureStore.
- SQLite crea tablas locales para operaciones pendientes y entidades cacheadas. El motor de sincronización aún no está implementado.
- Añadidos permisos/configuración inicial para cámara y galería; todavía no existe el flujo de captura/carga.
- Añadido workflow `.github/workflows/mobile-check.yml` para comprobar compatibilidad Expo y TypeScript.
- No se han ejecutado builds nativos ni pruebas en emuladores/dispositivos.
- CI API: typecheck pasa en el último run observado; la suite estaba ejecutándose. La ejecución anterior falló al cargar `jose` ESM en Jest; el test del gateway fue aislado mediante mocks y la nueva validación está pendiente.

- CI API #44240945920: **success**; migraciones, typecheck, pruebas unitarias y build de imagen Docker completados. La suite de pruebas pasó tras aislar el módulo ESM `jose` en el test del gateway.
- CI móvil inicial #44241083574 detectó que React Native 0.81.4 debía ser 0.81.5 para Expo SDK 54. Se corrigió la versión; nueva ejecución pendiente.
- Añadidas cinco rutas de navegación para Social, Eventos, Parejas, Círculos y Social Audio, con estados iniciales explícitos y sin simular funciones aún no conectadas.

- CI móvil #44241266400: **success**. Expo install compatibility check y TypeScript typecheck completados correctamente tras alinear React Native a 0.81.5.
- La verificación CI confirma instalación de dependencias y tipos; no equivale a un build nativo Android/iOS ni a pruebas en dispositivos.

## 2026-11-18 — Captura local de fotografías

- Añadida ruta `/capture` con solicitud de permisos y acceso a cámara/galería.
- Las imágenes seleccionadas se copian al almacenamiento persistente privado de la app y se registran en SQLite como `LOCAL_ONLY`.
- La pantalla muestra los borradores locales y no afirma que estén subidos.
- El backend de medios todavía no transfiere bytes a object storage; faltan endpoint/adaptador de almacenamiento, confirmación y flujo de sincronización.
- El CI móvil anterior #44241266400 pasó (Expo dependency check y TypeScript) antes de incorporar el flujo de captura; los cambios de captura requieren una nueva validación.

- El primer CI del flujo de captura (#44241552011) detectó una llave sobrante en la pantalla Social; se corrigió en `f21730ae024455bc73db12c75280a4b8e69ff4cd`. El nuevo CI #44241647278 está en ejecución.


## 2026-11-18 — Verificación móvil y transferencia inicial de medios

- CI móvil #44241647278: **success** en commit `f21730ae024455bc73db12c75280a4b8e69ff4cd`. Pasaron instalación, compatibilidad de dependencias Expo y TypeScript tras corregir el error sintáctico de la pantalla Social.
- La aplicación móvil conserva capturas de cámara/galería en almacenamiento privado local y SQLite. No hay sincronización automática todavía.
- Se añadió `PUT /api/v1/media/uploads/:uploadId/content`, autenticado por OIDC, para recibir bytes de un upload previamente creado.
- La transferencia valida ownership, UUID, estado, límite de 50 MiB, tamaño declarado y SHA-256. Los archivos se escriben atómicamente en el adaptador local configurado por `MEDIA_STORAGE_DIR` (por defecto `/var/lib/momentia/media`); la base de datos marca el asset como `quarantined`, no como listo para publicación.
- Se añadieron pruebas negativas de identificador, ownership/no existencia y discrepancia de tamaño.
- **Pendiente de CI:** API #44244678460 se inició para el primer cambio de transferencia; los cambios posteriores de pruebas dispararon una nueva ejecución. No declarar esta transferencia aceptada hasta que el último CI API termine en verde.
- Límites de esta entrega: el controlador todavía almacena el cuerpo en memoria hasta 50 MiB; el adaptador local es para desarrollo/una instancia y no almacenamiento compartido de producción; faltan detección MIME real, escaneo, procesamiento de variantes, limpieza de archivos huérfanos, adaptador S3-compatible y conexión del cliente móvil al flujo de upload.


## 2026-11-18 — Conexión móvil de la carga de fotografías (primera versión)

- CI móvil #44293237038: **success** en commit `f107343db020e5a19b1d0fa394fa6d365c9c94f6`. Pasaron instalación, verificación Expo y TypeScript.
- La app móvil calcula SHA-256 a partir del archivo local, crea la carga con clave idempotente y transfiere los bytes al endpoint autenticado mediante PUT binario.
- SQLite incorpora migración compatible para guardar identificador remoto y último error.
- La pantalla de captura ofrece sincronización manual y muestra los estados local, enviado/en cuarentena y error.
- CI API #44244715376: **success** para el endpoint de transferencia y su validación.
- La sincronización aún no es automática ni reanudable en segundo plano; el cliente lee el archivo completo para calcular el hash; no se ha probado en dispositivos físicos ni en redes intermitentes. El servidor mantiene el archivo en cuarentena y no genera variantes ni URL pública.
- La cifra global ponderada se recalculó a **26.84% (≈27%)** con los pesos de las ocho fases. Es un indicador de avance técnico, no de disponibilidad del producto.


## 2026-11-21 — Actualización verificada de CI, cobertura y auditoría de sincronización

**Rama:** `fix/migration-0036-duplicate-index`  
**Commit evaluado:** `302cf32c241481dd7a64e26c5eacf8b1d64105f9`  
**PR #2:** cambios aún sin merge.

### Evidencia CI

- API: run [44958766152](https://github.com/maki98-sys/MOMENTIA/actions/runs/44958766152) — success.
- Cobertura: run [44958766130](https://github.com/maki98-sys/MOMENTIA/actions/runs/44958766130) — success.
- Base de datos: run [44958766064](https://github.com/maki98-sys/MOMENTIA/actions/runs/44958766064) — success.
- Pruebas API: 21 suites aprobadas, 143 pruebas aprobadas (143/143). Incluye `sync-payload.validator.spec.ts`.
- Base de datos: migraciones e idempotencia aprobadas; backup/restore smoke test: 61/61 migraciones y 65 tablas; SQLite schema smoke test y auditoría de columnas de secretos aprobados; prueba concurrente de membresía COUPLE aprobada.
- Cobertura Jest global: statements 21.48%, branches 20.05%, functions 21.35%, lines 22.92%.

### Entrega de validación de payload sync

- Commit `302cf32c241481dd7a64e26c5eacf8b1d64105f9`.
- Añadidas pruebas de envelope válido/inválido, campos adicionales, lotes 1–50, números no finitos, valores no JSON, tamaño de cadenas, arrays, cantidad de claves, claves de contaminación de prototipo, profundidad y tamaño total.
- Las pruebas se ejecutaron en CI y pasaron.
- Esto mejora la validación de entrada; no certifica la autorización, persistencia, orden, reintentos ni sincronización completa del cliente.

### Hallazgo histórico de seguridad — snapshots de sincronización

**Estado del hallazgo original:** identificado el 21 de noviembre y parcialmente corregido en la actualización del 22 de noviembre que aparece más abajo. El texto siguiente describe el riesgo original; no debe interpretarse como descripción del código actual.

La inspección estática de `SyncService.snapshot()` identificó un riesgo que requiere resolver antes de certificar snapshots paginados como seguros: al crear el snapshot, se materializa información autorizada y se persiste en `sync_snapshot_sessions.data`. Las páginas posteriores recuperan ese contenido congelado por `snapshotId` y `user_id`, sin volver a evaluar todos los permisos de origen. Si después de crear el snapshot se revoca una membresía o cambia una relación/bloqueo/visibilidad, el contenido materializado podría seguir disponible hasta la expiración de la sesión (30 minutos).

- Estado: hallazgo de revisión estática, no explotación demostrada.
- Severidad propuesta: alta por posible exposición de contenido privado tras revocación.
- No se declara resuelto ni se contabiliza como seguridad aceptada.
- Corrección requerida: invalidación fiable de snapshots ante cualquier cambio de autorización relevante o revalidación por sección/registro en cada página. Añadir pruebas de integración PostgreSQL para revocación de membresía, bloqueo, unfollow y cambio de visibilidad entre páginas.
- También probar liberación, expiración, límite de sesiones, paginación y aislamiento entre usuarios.

### Porcentajes

No se modifica el avance global ni el avance ponderado de backend en esta actualización. El control de fase del 18 de noviembre necesita una revisión completa por tareas y aceptación de módulos; el CI de esta entrega solo acredita los pasos descritos arriba. La cobertura de código no se debe interpretar como porcentaje de implementación.



---

## Auditoría backend y base de datos — actualización 2026-11-22

**Alcance de esta actualización:** base de datos, backend, seguridad, migraciones y pruebas. **Frontend excluido deliberadamente** porque todavía no ha comenzado.

### Cambios y verificaciones

- Migraciones corregidas o añadidas: `0036`, `0039`, `0056`, `0061`–`0066`.
- Última verificación de base de datos completada: workflow `44970052087`, commit `995d91f`, resultado **success**. Aplicación de migraciones, repetición/idempotencia, ledger, integridad, smoke test de timeline, backup/restore, SQLite y prueba de membresía COUPLE.
- Última cobertura completada disponible: workflow `44970052062`, commit `995d91f`; **169/169 pruebas unitarias, 24 suites**.
- Cobertura en ese corte: statements **30,29%**, branches **28,33%**, functions **29,24%**, lines **32,26%**. La siguiente ejecución está en curso tras añadir más pruebas y correcciones; estos valores no se presentan como resultado del head actual.
- Se añadieron pruebas PostgreSQL para revocación entre páginas, unfollow, bloqueo, cambio de audiencia, autor suspendido, timeline archivado, cursor, redacción de payloads de pull, expiración, liberación, aislamiento por usuario y límite de sesiones. También se añadió una prueba de serialización de revocación de membresía; su CI está pendiente.
- PR #2 permanece abierto y sin fusionar.

### Correcciones de seguridad y backend realizadas

- Las páginas de snapshot vuelven a consultar los datos con permisos actuales; la sesión ya no conserva una copia JSONB de contenido antiguo.
- El pull incremental entrega metadatos y `payload: null`; el cliente debe refrescar mediante snapshot para no reproducir contenido que pudo perder autorización.
- Se introdujeron bloqueos transaccionales compartidos/exclusivos para coordinar lecturas autorizadas y mutaciones de permisos, incluyendo perfil, membresías, relaciones, bloqueos, espacios, publicaciones, comentarios, álbumes y multimedia.
- Se reforzó Social Audio: cuenta activa, participación persistida al entrar/salir, revocación y expiración de sockets.
- Se reforzaron moderación, exportación de privacidad, notificaciones, registro de dispositivos y manejo de conexiones PostgreSQL.
- El registro de dispositivos ahora exige una clave UUID estable; transferir la instalación a otra cuenta revoca sesiones y entregas push pendientes.

### Pendientes que impiden certificar el backend como completo

1. Terminar la auditoría semántica de las 66 migraciones, dependencias, triggers, restricciones, índices y rutas de escritura; que todas apliquen en CI no sustituye esa revisión.
2. Esperar CI del head actual: TypeScript, pruebas unitarias, E2E PostgreSQL, build, contenedor y database-check.
3. Completar pruebas de concurrencia y autorización para todos los cambios relevantes, no solo membresías.
4. Revisar retención/limpieza de `sync_change_log`, recibos de operaciones sync, snapshots expirados y colas/outbox.
5. Implementar cancelación real de suscripciones externas antes de completar la eliminación de una cuenta; hoy falta el adaptador del proveedor.
6. Integrar proveedor de billing: endpoint/webhook real con verificación de firma, checkout, portal, cancelación y reconciliación.
7. Completar Social Audio con adaptadores y autenticación de proveedores musicales; el backend actual coordina sesiones/cola/estado, pero no implementa la reproducción licenciada en cada teléfono.
8. Completar entrega push con recibos del proveedor y soporte Web Push; actualmente los tokens push están limitados a iOS/Android.
9. Incorporar rate limiting distribuido para endpoints públicos y eventos WebSocket, además de controles de abuso.
10. Ampliar cobertura y pruebas de integración de privacidad, procesamiento multimedia, billing, parejas, eventos, notificaciones y autorización cruzada.
11. Completar la revisión de producción: observabilidad, alertas, rotación de claves, recuperación, almacenamiento de objetos y pruebas de restauración de medios.

**No se asigna porcentaje global de backend** hasta cerrar el inventario de módulos y definir ponderaciones verificables. La cobertura de tests se informa por separado. No se inicia frontend ni se fusiona el PR #2 en esta fase.
