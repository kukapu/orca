# Reconstruccion Estable 1.4.198-kukapu.1

## Procedencia Y Autorizacion

El usuario autoriza reconstruir las personalizaciones sobre el corte estable,
sin retirar cambios a ciegas ni modificar produccion. Rama candidata en el mismo
worktree: `kukapu/release-1.4.198-kukapu.1`. La antigua rama de automatizacion,
con HEAD `5e5f934183`, queda conservada, incluido el merge main-tip no publicado.

- Tag oficial anotado: `36b992b862c1c43eddab6cb5fa7bb2f69cc1f697`.
- Commit oficial peeled: `e0826956fcfc532f5a1e55b5e081f2e57e553c43`.
- Checkpoint propio anterior: `3c91f86317628ee2758745750a03adb4b09ab93e`.
- Base upstream de ese checkpoint: `5ae76afda6e24a91cc4d886214e44b2d5700ce67`, incluida en el tag.
- Merge normal del tag: `6f2a7aca95`, sin conflictos textuales, 82 paths oficiales.
- Publicacion previa F: `da3def1b0f107f5294860282ddcb39d3bd024741`.

El usuario autorizo explicitamente por pregunta el puente `git merge -s ours`
SOLO para publicar historia: P tiene padres C,F y tree(P)=tree(C). No se usa para
resolver codigo ni se incorpora la rama main-tip antigua. Tag fork y artefactos
identifican C; main-kukapu identifica P. Futuras integraciones nacen del tag fuente,
no de P: un fixture Git demuestra que la otra ruta puede omitir cambios oficiales
que entran en la siguiente release. Politica y bundle efectivo actualizados.

## Inventario De Conservacion

| Bloque propio | Tratamiento |
| --- | --- |
| Modelos worker OpenCode/Pi e IDs anidados | Recuperado del checkpoint, incluidos catalogos y pruebas. |
| Orden seguro de flags OpenCode | Recuperada la implementacion final, no soluciones intermedias duplicadas. |
| Modelo por automatizacion | Recuperado, junto con la politica nueva y precheck estable. |
| Pi owner, cola, session fencing y opciones observadas | Recuperados los productores y pruebas del checkpoint. |
| Evidencia modelo/thinking/variant | Conservada la distincion solicitado/observado y sus filtros de identidad/host. |
| Transcripts OpenCode/Pi y snapshots | Recuperados lectores, limites, digest y fencing de cursores del contrato estable. |
| Preguntas, reports tardios y stop | Recuperado checkpoint y portadas correcciones posteriores de ocupacion vs routing. |
| Disponibilidad del agente en host y composer readiness | Conservados gates local/federado del checkpoint. |
| Sesiones durables, teardown y sockets | Recuperados routing por owner, stop sweep y presupuesto sun_path. |
| Modelos retirados source control | Conservado saneamiento solo de IDs explicitamente retirados. |
| Geometria medida de overlays | Conservados hooks y consumidores terminal/browser/emulator/structured pane. |
| Linux/glibc e instalador protegido | Parche propio node-pty y exclusiones; instalador externo y tests portados, no ejecutado. |
| Guias e historico de entrega | Portados documentos sin renombrar evidencia197 como198; aclaraciones OpenCode regeneradas. |

Ports puros posteriores: instalador `99f43d2e4b` y harness `42ab555177` se
conservaron en `c1c92ff802`; documentos/politica `19d1c8836c`, `cb1c108caa`,
`da3def1b0f`, `5e5f934183` en `e5c93307be`, `6285f647b1`, `f5781b1cc6`,
`dc6d61cbd8`. Conflictos exclusivamente documentales conservaron el historico.
No cherry-pick de merges main-tip ni copia de toda la reorganizacion RPC.

No aplicables al corte: composicion modal Pi, lazy mount del browser, cursores
upstream nuevos y metadatos tool-call posteriores. Se conservan los requisitos
propios subyacentes, sin importar features excluidas solo para aplicar sus fixes.

Manifiestos identicos a v1.4.198. Lockfile oficial con solo tres referencias al
hash del parche propio node-pty `6cdcbddd3085ae558427249bf1e033e1bb1e84af218e17bae2b89286c651387c`.
Se retiro drift de resoluciones no justificado; no se normalizo el lockfile.
Detalles en `reconstruction-198-inputs.md`. Cache generado cloud excluido mediante
su gitignore; conservado en disco, no limpiado ni empaquetado deliberadamente.

## Compatibilidad Persistida

La release estable crea schema30; el fork anterior entregado escribia schema39.
El candidato no migra datos hacia atras ni cambia el stamp para fingir compatibilidad.

- Inspeccion read-only previa, forma conocida39 validada, sin recreate/migrate39.
- Nuevas DB permanecen30; versiones futuras/intermedias no certificadas se rechazan.
- Mailboxes Run/Dispatch aisladas; ACK y fencing por consumidor/generacion.
- Reservas write/Enter inciertas preservadas; no replay automatico.
- Identidades y endpoints actualizados atomicamente, sin inventar owner remoto.
- Reports aceptados conservan facts compatibles con el projector exacto de F.
- Journals structured historicos legibles y protegidos contra sobrescritura/borrado.
- Archivo almacenado no prueba exited; releases inciertos publican unverifiable.
- Workers structured activos o sin prueba de liberacion impiden admision; historia
  correctamente liberada se admite incluso con hash de capability revocado conservado.
- Cambios de identidad no justificados se rechazan, no se transfieren a ciegas.

Detalles y limites en `persisted-schema39-admission.md`. Esta compatibilidad
concreta es necesaria por datos ya entregados; no porta la ejecucion native-born,
el motor lifecycle de upstream ni su framework general de observations.

Instalacion/rollback requieren ventana externa sin escritores concurrentes ni
trabajo live/unverifiable pendiente. No se examinaron datos privados ni se afirma
quiescencia real del VPS. Backups de binario NO sustituyen backup consistente de datos.

## Evidencia De Codigo

Logs privados en `.tmp/sync/`, sin publicar tokens ni pairing:

- `reconstruction-db-tests-final.log`: 151 suites, 1527 tests, cero fallos/skips.
- `reconstruction-fork-tests.log`: 53 suites, 519 tests, cero fallos/skips.
- Politica/precheck/linaje: 123 tests, siete suites, incluido fixture Git de siguiente release.
- `reconstruction-tc-release.log`: pnpm tc, exit0 con Node24/heap8GB.
- `reconstruction-quality-release.log`: calidad contra v1.4.198, cero findings.

Los conteos anteriores son por lote, no una suma de casos unicos entre lotes.
La revision independiente cerro defectos concretos de reportes tardios, evidencia
legacy, routing/truncado de archivos y admision de historia liberada. La tanda
integrada detecto dos carreras por snapshot SQLite nuevo antes del claim atomico;
se preparo SQL/metadata antes del SAVEPOINT, sin relajar las expectativas previas.
La repeticion completa y doce nuevos interleavings30/39 pasan.

Estos resultados NO certifican empaquetado, ejecucion E2E, instalacion ni todas
las plataformas. Los gates posteriores y OIDs finales C/P se registran en metadata
y evidencia de entrega para no crear referencias circulares en este commit fuente.
