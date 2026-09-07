# Features del fork kukapu

Espacio de trabajo para propuestas, decisiones y planes de implementacion propios
de `kukapu/orca`, en paralelo al desarrollo oficial de Orca.

## Iniciativas

| Iniciativa                                                   | Estado                                                               | Release objetivo                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------- |
| [Orquestacion OpenCode y Pi](./opencode-pi-orchestration.md) | Primer bloque de fiabilidad implementado y verificado; sin desplegar | `1.4.197-kukapu.2` (planificada) |

## Convenciones

- Un documento por iniciativa, con contexto, evidencia, decisiones, fases y criterios de aceptacion.
- Separar capacidades existentes, defectos observados en codigo, hipotesis y propuestas pendientes.
- Registrar comando, revision y resultado de cada verificacion; no marcar una fase como terminada solo porque se haya escrito el codigo.
- Mantener cambios pequenos y reutilizar los contratos existentes para facilitar los merges diarios de upstream.
- Si upstream incorpora una solucion equivalente, revisar el plan y seguir la [politica de sincronizacion](../reference/upstream-sync-automation.md), sin mantener dos implementaciones paralelas.
- Esta carpeta no sustituye los contratos tecnicos de `docs/reference/` ni el historial de builds de `docs/releases/`.
- Las features propias, incluidas las tres trasladadas desde `docs/features/`, se documentan aqui. Los fixes de `docs/fixes/` conservan su ubicacion.

## Antecedentes

- [Modelos de workers OpenCode](./opencode-worker-launch-models.md).
- [Modelo y thinking de workers Pi](./pi-worker-launch-models.md).
- [Orden del subcomando OpenCode run](../fixes/opencode-run-subcommand-order.md).
- [Recuperacion del propietario de estado Pi](../fixes/pi-status-dead-owner-reclaim.md).
- [Build y despliegue del fork](./local-build-deployment.md).
- [Historial de releases](../releases/README.md).

La proxima revision prevista sigue la convencion existente `v1.4.197-kukapu.2.md`
para el documento de release y `1.4.197-kukapu.2` para la version de la aplicacion.
Planificar una release no significa que este compilada, instalada ni verificada.
