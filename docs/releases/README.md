# Releases del fork kukapu/orca

Una entrada `.md` por versión que construimos e instalamos desde `main-kukapu` (`docs/releases/vX.Y.Z-kukapu.N.md`). El flujo de build/instalación está en [`docs/features-kukapu/local-build-deployment.md`](../features-kukapu/local-build-deployment.md).

| Versión                                     | Fecha build | Estado                                                   | Base upstream                               |
| ------------------------------------------- | ----------- | -------------------------------------------------------- | ------------------------------------------- |
| [v1.4.194-kukapu.1](./v1.4.194-kukapu.1.md) | 2026-09-01  | Sustituida por v1.4.194-kukapu.2                         | upstream/main (post v1.4.194)               |
| [v1.4.194-kukapu.2](./v1.4.194-kukapu.2.md) | 2026-09-01  | Sustituida por v1.4.196-kukapu.1                         | upstream/main (post v1.4.194)               |
| [v1.4.195-kukapu.1](./v1.4.195-kukapu.1.md) | 2026-09-02  | Compilada pero nunca instalada                           | upstream/main (sync run 1)                  |
| [v1.4.196-kukapu.1](./v1.4.196-kukapu.1.md) | 2026-09-03  | Sustituida por v1.4.197-kukapu.1                         | upstream/main (sync run 2)                  |
| [v1.4.197-kukapu.1](./v1.4.197-kukapu.1.md) | 2026-09-04  | Instalada en `olares-one`                                | upstream/main (sync run 3)                  |
| [v1.4.197-kukapu.2](./v1.4.197-kukapu.2.md) | 2026-09-06  | Candidato empaquetado y probado localmente; no instalado | `ee2e5da315` + cambios locales documentados |

Convenciones:

- La versión se inyecta en el build con `ORCA_LOCAL_BUILD_VERSION=<versión> pnpm run build:linux`.
- Cada entrada lista los cambios propios del fork y los de upstream que la versión anterior no tenía, más cualquier incidencia de build o instalación.
- Los detalles de cada fix/feature del fork viven en `docs/fixes/` y `docs/features-kukapu/`; las releases solo los referencian.
