# Admisión del estado persistido F39 desde stable198+fork

El candidato conserva schema30 para bases nuevas y antiguas compatibles. Una base
publicada por `da3def1b0f` con schema39 tiene una ruta de apertura distinta: no se
ejecutan `createTables`, migraciones, reconstrucciones ni reparaciones de tablas.

## Condiciones de admisión

- La inspección inicial usa una conexión de solo lectura, antes de la apertura
  operativa. Así, rechazar una base WAL no provoca un checkpoint al cerrar el probe.
- Se cotejan columnas, tipos, defaults, nulabilidad, claves, CHECKs, índices y
  triggers conocidos. El catálogo se deriva del DDL conocido en un SQLite
  `:memory:` aislado; ese DDL nunca se ejecuta sobre el archivo inspeccionado.
- Se permiten tablas opacas ajenas al contrato y hechos históricos huérfanos. No se
  interpreta ni se corrige el contenido de journals durante la admisión. El lector
  de archivos valida su formato cuando se solicita la acción.
- Se rechazan versiones31–38, futuras, formas39 incompletas y stamps antiguos con
  columnas del fork. Tampoco se aceptan nuevos triggers escritores sobre tablas
  conocidas ni nuevas restricciones que cambien su contrato.
- Una identidad structured activa o un recurso structured no liberado impide abrir
  con este runtime PTY. `failed`, `succeeded` o la desconexión SSH no demuestran la
  muerte del proceso: un recurso no liberado sigue bloqueando. Los recursos PTY
  ordinarios y la historia structured liberada no se rechazan por sí solos.

La apertura39 conserva el journal mode existente, las tablas y sus índices. El
único backfill es `INSERT OR IGNORE` de los handles actuales de coordinador; el
trigger de routing F se valida y se conserva, no se recrea.

## Requisito del instalador/operador

**La quiescencia es una precondición externa.** El instalador debe comprobar que
ningún otro runtime puede escribir o migrar esta base durante el reemplazo y la
apertura. El inspector no es un lock de despliegue y no sustituye esa comprobación.
No deben coexistir escritores de versiones distintas sobre el mismo archivo.

La copia de seguridad debe ser consistente e incluir el estado WAL pertinente;
copiar únicamente el archivo principal mientras hay escritores activos no basta.
La autoridad de ejecución SSH debe verificar sus propios procesos. Una conexión
perdida se mantiene como `unverifiable`, nunca se interpreta como `exited` para
forzar limpieza o una segunda ejecución.

Ante rechazo, conservar los archivos y usar un runtime compatible. No bajar
`user_version`, borrar índices, eliminar reservas inciertas ni reconstruir tablas
para superar la puerta. La admisión de datos no certifica empaquetado, instalación,
recuperación de procesos reales ni compatibilidad E2E de clientes de otra versión.

## Evidencia reproducible

Las pruebas de `db/schema/persisted-schema39-{admission,roundtrip}.test.ts` usan el
constructor real y fixtures físicas. Cubren ACK/fencing de Run y worker, rotación
de generación/recursos, reservas1/2/3, reapertura y conservación de historia opaca.
El roundtrip ejecuta el projector puro F original, fijado al blob
`787c616dd927217b67338c279ff1609a9d50c643`, contra reportes producidos por el candidato.
