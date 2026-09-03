# Releases del fork kukapu/orca

Una entrada `.md` por versión que construimos e instalamos desde `main-kukapu` (`docs/releases/vX.Y.Z-kukapu.N.md`). El flujo de build/instalación está en [`docs/features/local-build-deployment.md`](../features/local-build-deployment.md).

| Versión | Fecha build | Estado | Base upstream |
| --- | --- | --- | --- |
| [v1.4.194-kukapu.1](./v1.4.194-kukapu.1.md) | 2026-09-01 | Sustituida por v1.4.194-kukapu.2 | upstream/main (post v1.4.194) |
| [v1.4.194-kukapu.2](./v1.4.194-kukapu.2.md) | 2026-09-01 | Sustituida por v1.4.196-kukapu.1 | upstream/main (post v1.4.194) |
| [v1.4.195-kukapu.1](./v1.4.195-kukapu.1.md) | 2026-09-02 | Compilada pero nunca instalada | upstream/main (sync run 1) |
| [v1.4.196-kukapu.1](./v1.4.196-kukapu.1.md) | 2026-09-03 | Instalada en `olares-one` | upstream/main (sync run 2) |

Convenciones:

- La versión se inyecta en el build con `ORCA_LOCAL_BUILD_VERSION=<versión> pnpm run build:linux`.
- Cada entrada lista los cambios propios del fork y los de upstream que la versión anterior no tenía, más cualquier incidencia de build o instalación.
- Los detalles de cada fix/feature del fork viven en `docs/fixes/` y `docs/features/`; las releases solo los referencian.
