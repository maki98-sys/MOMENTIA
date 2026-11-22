# Auditoría de CI y cobertura del backend — 2026-11-21

## Alcance y referencia

Rama: `fix/migration-0036-duplicate-index`  
Commit evaluado: `cd61da6aa7ca057bfed09acd9508c69b29402929`  
PR: [#2](https://github.com/maki98-sys/MOMENTIA/pull/2)  
No se realizó merge.

## Evidencia CI

| Workflow | Run | Resultado |
|---|---:|---|
| API | [44913767880](https://github.com/maki98-sys/MOMENTIA/actions/runs/44913767880) | Success |
| Base de datos | [44913772623](https://github.com/maki98-sys/MOMENTIA/actions/runs/44913772623) | Success |
| Cobertura API | [44913772662](https://github.com/maki98-sys/MOMENTIA/actions/runs/44913772662) | Success |

### API

Pasaron typecheck, unit tests, build y build del contenedor de producción.

### Base de datos

Pasaron aplicación de migraciones, reejecución idempotente, verificación del ledger, integridad, planes de consulta representativos, smoke test de timeline con 10.000 filas, backup/restore, esquema SQLite y concurrencia de membresía COUPLE.

### Pruebas unitarias y cobertura

- 20 suites aprobadas de 20.
- 130 pruebas aprobadas de 130.
- Incluye `billing.service.spec.ts`, con seis casos de Billing.

| Métrica | Ejecución anterior | Ejecución actual |
|---|---:|---:|
| Statements | 19,92% | 20,36% |
| Branches | 18,55% | 18,89% |
| Functions | 20,25% | 20,87% |
| Lines | 21,21% | 21,67% |

La mejora está medida por Jest en el workflow de cobertura. La cobertura sigue siendo baja: pasar todas las pruebas existentes no significa que todos los comportamientos ni todo el código estén cubiertos.

## Interpretación y límites

1. CI confirma que el commit evaluado compila, supera las pruebas actuales y pasa las comprobaciones de base de datos incluidas en esos workflows.
2. No demuestra por sí solo que los cinco dominios de producto estén completos, que el backend esté integrado con todos los proveedores ni que los flujos móviles end-to-end funcionen.
3. No se publica un nuevo porcentaje global ni de fase backend en esta auditoría: el control maestro tiene pesos por módulo, pero esta ejecución no aporta una medición completa y aceptada de cada módulo ponderado. Asignar un porcentaje nuevo sin esa matriz sería inventarlo.
4. No se ha fusionado PR #2 ni se han alterado ramas base.

## Próxima prioridad técnica

Ampliar pruebas de sincronización y privacidad: aislamiento por usuario, permisos revocados, cursores adelantados/expirados, snapshots paginados y consistentes, checkpoints por dispositivo, límites de tamaño, liberación de snapshots y contenido de secciones privadas. Después medir de nuevo cobertura y revisar los cambios de comportamiento con pruebas de integración PostgreSQL.

## Criterios para declarar backend completo

- Todos los módulos funcionales del alcance implementados y conectados.
- Autorización y aislamiento probados en cada recurso sensible.
- Integraciones externas configuradas con proveedores reales o adaptadores verificables.
- Pruebas unitarias, integración, contrato y E2E representativas aprobadas.
- Cobertura suficiente por módulo, con ramas críticas cubiertas; no basta un porcentaje global.
- Migraciones reproducibles, observabilidad, manejo de fallos y documentación operativa.
