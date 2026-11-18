# MOMENTIA — Control maestro de desarrollo

**Versión:** 1.1  
**Repositorio:** `maki98-sys/MOMENTIA`  
**Rama de trabajo:** `docs/arquitectura-y-alcance-v1`  
**Estado:** base de datos en revisión final; bootstrap del backend implementado y aceptado por CI; módulos de producto aún no iniciados.

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
| 1. Modelo y diseño de datos | 8% | modelo relacional, migraciones, índices, reglas y datos locales | 90% verificado |
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
- Migraciones y seeds: 95% (tres migraciones aplicadas, runner con ledger e idempotencia verificados; seeds sintéticos pasan en CI).
- Índices, consultas y paginación: 85% (índices y consultas representativas con EXPLAIN verificados; smoke test sintético de 10.000 entradas y consulta latest-50 completado; falta carga representativa prolongada y ajuste fino).
- Persistencia local SQLite: 85% (esquema y smoke tests pasan; falta política de cifrado/versionado y uso desde la app).
- Retención, exportación y borrado: 70% (tablas y estados de solicitud implementados; los plazos se mantienen desactivados hasta aprobación legal y la ejecución corresponde al backend).
- Pruebas de integridad y migración: 95% (CI PostgreSQL 16, runner idempotente, restricciones, concurrencia, SQLite, seeds, EXPLAIN, backup/restore y smoke test de 10.000 entradas verdes; faltan pruebas de carga prolongada y casos límite ampliados).

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
| Cuenta, identidad y perfiles | No iniciado | 0% |
| Espacios, roles e invitaciones QR/enlace | No iniciado | 0% |
| Eventos y álbumes colaborativos | No iniciado | 0% |
| Parejas y diario privado | No iniciado | 0% |
| Círculos privados | No iniciado | 0% |
| Red social, feed e interacciones | No iniciado | 0% |
| Cámara, galería, EXIF y multimedia | No iniciado | 0% |
| Timeline y recuerdos | No iniciado | 0% |
| Offline y sincronización | No iniciado | 0% |
| Social Audio | No iniciado | 0% |
| Notificaciones | No iniciado | 0% |
| PWA de invitados | No iniciado | 0% |
| Moderación y administración | No iniciado | 0% |
| Monetización y cuotas | No iniciado | 0% |

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
