# 09. Decisiones pendientes y ADR

Este documento evita convertir supuestos en compromisos. Cerrar decisiones mediante prototipos, pruebas, comparación de proveedores o revisión legal.

## Decisiones pendientes
| ID | Tema | Validación requerida |
|---|---|---|
| DEC-001 | Autenticación | Auth propio vs proveedor; métodos disponibles por país |
| DEC-002 | PostgreSQL | Proveedor, región, backups, alta disponibilidad y costo |
| DEC-003 | Object storage | R2 vs S3/alternativas; egress, lifecycle, región y límites |
| DEC-004 | Redis/workers | Servicio, tamaño, retención y dead-letter |
| DEC-005 | Email | Entregabilidad, dominio y costos |
| DEC-006 | Pagos | País, moneda, comisiones, recurrencia y políticas de tiendas |
| DEC-007 | Música | Catálogo licenciado o proveedor con API/SDK compatible |
| DEC-008 | Edad mínima | Política de menores y obligaciones por mercado |
| DEC-009 | Retención | Cuotas, plazos, borrado y exportación |
| DEC-010 | PWA | Alcance de invitado, auth y límites de navegador |
| DEC-011 | Cifrado local | Datos que requieren cifrado y gestión de claves |
| DEC-012 | Analítica | Métricas, consentimiento, retención y proveedor |

## ADR-001 — Monolito modular inicial
**Estado:** propuesto. NestJS modular y workers por proceso; no microservicios prematuros. Revisar cuando métricas de carga, despliegue o autonomía lo justifiquen.

## ADR-002 — PostgreSQL como fuente de verdad
**Estado:** propuesto. Relaciones, permisos, metadatos y estados duraderos en PostgreSQL. Redis se reserva para caché, colas y estado efímero.

## ADR-003 — Multimedia fuera de la base de datos
**Estado:** propuesto. Bytes en object storage privado; metadatos y referencias en PostgreSQL.

## ADR-004 — Offline-first
**Estado:** propuesto. Cola local persistente y reconciliación con servidor. Sincronización remota requiere conectividad; background depende del SO.

## ADR-005 — Social Audio sujeto a licencias
**Estado:** bloqueado para playback comercial hasta seleccionar fuente. Diseñar sincronización desacoplada del proveedor, pero no extraer ni redistribuir catálogos protegidos. Comparar derechos, SDK, países, número de oyentes y uso comercial.

## Proceso para cerrar ADR
Registrar contexto, alternativas, criterios, consecuencias, riesgos, responsable y fecha. Una decisión aprobada actualiza los documentos afectados.
