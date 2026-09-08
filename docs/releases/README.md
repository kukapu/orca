# Releases del fork kukapu/orca

Una entrada `.md` por versión preparada del fork (`docs/releases/vX.Y.Z-kukapu.N.md`), distinguiendo build, publicación e instalación. Desde `.198`, la fuente canónica es el tag del fork basado en un corte estable oficial; `main-kukapu` conserva el historial de publicación, no es la base de la siguiente integración. El flujo está en [releases estables](../reference/upstream-sync-automation.md) y la instalación externa en [instalador Linux](../features-kukapu/install-local-linux-release.md).

| Versión                                     | Fecha build | Estado                                                                 | Base upstream                        |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------- | ------------------------------------ |
| [v1.4.194-kukapu.1](./v1.4.194-kukapu.1.md) | 2026-09-01  | Sustituida por v1.4.194-kukapu.2                                       | upstream/main (post v1.4.194)        |
| [v1.4.194-kukapu.2](./v1.4.194-kukapu.2.md) | 2026-09-01  | Sustituida por v1.4.196-kukapu.1                                       | upstream/main (post v1.4.194)        |
| [v1.4.195-kukapu.1](./v1.4.195-kukapu.1.md) | 2026-09-02  | Compilada pero nunca instalada                                         | upstream/main (sync run 1)           |
| [v1.4.196-kukapu.1](./v1.4.196-kukapu.1.md) | 2026-09-03  | Sustituida por v1.4.197-kukapu.1                                       | upstream/main (sync run 2)           |
| [v1.4.197-kukapu.1](./v1.4.197-kukapu.1.md) | 2026-09-04  | Sustituida por v1.4.197-kukapu.2                                       | upstream/main (sync run 3)           |
| [v1.4.197-kukapu.2](./v1.4.197-kukapu.2.md) | 2026-09-07  | Sustituida en el VPS por v1.4.198-kukapu.1                             | `42ab555177` (upstream `314506003a`) |
| [v1.4.198-kukapu.1](./v1.4.198-kukapu.1.md) | 2026-09-08  | Instalada y verificada en VPS; assets en borrador; clientes pendientes | Tag exacto `v1.4.198` (`e0826956fc`) |

Convenciones:

- La versión se inyecta con `ORCA_LOCAL_BUILD_VERSION=<versión>`. La automatización usa el flujo node-direct documentado, sin instaladores CLI globales ni publicación implícita del pack.
- Registrar por separado commit fuente C, publicación P y tag del fork: los artefactos y el tag identifican C, aunque `main-kukapu` avance mediante un puente histórico P con el mismo árbol.
- Conservar `orca-release-provenance.json` verificado en la release: la fuente de la siguiente actualización no debe depender de mantener el workspace temporal.
- Publicado no significa instalado. Identificar el host/plataforma comprobados y los clientes pendientes; no trasladar evidencia de una build anterior a una nueva.
- Cada entrada lista los cambios propios del fork y los de upstream que la versión anterior no tenía, más cualquier incidencia de build o instalación.
- Los detalles de cada fix/feature del fork viven en `docs/fixes/` y `docs/features-kukapu/`; las releases solo los referencian.
