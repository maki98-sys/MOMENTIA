# MOMENTIA — Control maestro de desarrollo

**Versión:** 1.1  
**Repositorio:** `maki98-sys/MOMENTIA`  
**Rama de trabajo:** `docs/arquitectura-y-alcance-v1`  
**Estado:** construcción inicial de base de datos; migraciones fuente creadas, ejecución PostgreSQL pendiente.

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
| 1. Modelo y diseño de datos | 8% | modelo relacional, migraciones, índices, reglas y datos locales | 83% verificado |
| 2. Backend | 22% | API, autenticación, dominios, permisos, workers y tiempo real | 0% |
| 3. Frontend móvil y web | 20% | Android/iOS, navegación, pantallas, estados y PWA | 0% |
| 4. Offline y sincronización | 14% | SQLite, cola local, reintentos, conflictos y cargas | 0% |
| 5. Integración end-to-end | 10% | conexión completa, notificaciones, storage y proveedores | 0% |
| 6. Calidad y seguridad | 12% | pruebas, hardening, rendimiento, accesibilidad y recuperación | 0% |
| 7. Lanzamiento | 6% | builds, beta, tiendas, despliegue, monitoreo y soporte | 0% |
| **Total** | **100%** | | **6.6% global verificado** |

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

**Avance verificado actual: 83% de la fase (6.6% del proyecto).** Desglose ponderado y conservador:
- Modelo relacional y restricciones: 95% (esquema base, tablas operativas y reglas principales implementadas; falta revisión final de cobertura).
- Migraciones y seeds: 80% (tres migraciones aplicadas en CI; conjunto de seeds de desarrollo pendiente).
- Índices, consultas y paginación: 70% (índices creados; falta validar consultas con EXPLAIN y carga representativa).
- Persistencia local SQLite: 85% (esquema y smoke tests pasan; falta política de cifrado/versionado y uso desde la app).
- Retención, exportación y borrado: 70% (tablas de solicitudes y políticas preparadas; faltan plazos aprobados y procesos de ejecución).
- Pruebas de integridad y migración: 85% (CI PostgreSQL/SQLite y concurrencia COUPLE verdes; faltan rollback/restauración y más casos límite).

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

## 8. Próxima ejecución técnica

1. Inspeccionar todos los archivos y ramas existentes antes de tocar estructura.
2. Completar inventario de repo y registrar qué existe realmente.
3. Definir arquitectura ejecutable, monorepo, convenciones, variables de entorno de ejemplo y CI.
4. Preparar contratos y estructura de backend.
5. Implementar backend por módulos con pruebas.
6. Construir frontend conectado a contratos reales.
7. Implementar migraciones y persistencia completa; completar SQLite y sincronización offline.
8. Integrar, probar, asegurar y preparar builds.

**No declarar la aplicación creada hasta tener una versión ejecutable y comprobada en dispositivos/emuladores.**
