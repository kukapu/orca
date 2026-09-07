# Integracion upstream para el candidato 197.2

## Autorizacion

El usuario aprueba un commit LOCAL de proteccion antes de integrar upstream,
resolver conflictos y reconstruir el candidato 1.4.197-kukapu.2. No se autoriza
push ni instalacion/reinicio de produccion. La instalacion la ejecutara el
usuario desde una terminal fuera de Orca, con instrucciones y rollback.
La mejora de compactacion de OpenCode queda como pendiente independiente.
ULTIMA ORDEN: para los pasos de preparacion/diagnostico de tests donde el
proveedor no es el objeto de la prueba, usar el modelo elegido por coste
`opencode-go/muse-spark-1.3-contributor`. Ambos workers reanudados cambiados
in-place y footer Muse Spark 1.3 Contributor OpenCode Go verificado. Los E2E
simulados no hacen llamadas LLM; el modelo corresponde al worker que los opera.
Cualquier prueba de un proveedor real conserva su modelo especifico y requiere
un gate separado. Esta orden sustituye Grok para el trabajo rutinario restante.

## Estado Actual Tras Reanudacion

- Recheck posterior a los ajustes de fixtures: simulado1/1 y web4/4 PASSED.
  `ask --json` devolvia envelope `{ok,result}` y el fake leia campos en el tope:
  no era una cancelacion real. El web build carecia de `VITE_EXPOSE_STORE=true`:
  el poll nulo no demostraba un fallo de idioma del producto. Bundle web actual
  es E2E y NO se debe empaquetar; reconstruccion production pendiente.
  Informe /tmp/opencode/post-upstream-e2e-recheck-sep7.md.
- Integracion registrada: checkpoint3c91f86317, mergeautomatizaciondfc86dbbc3,
  mergeupstream5d0550794f y scriptinstalacion99f43d2e4b. Upstream314506003a y
  checkpoint son ancestros comprobados. Sin push ni instalacion.
- Tipos limpios y8533tests/20skip verdes. node-pty fue reconstruido por el hook
  desde cache sin descargas; nuevo binario verificado bajo Electron y contra
  el floor glibc2.31. Installer14tests en senuelos, nunca apply real.
- Build E2E/CLI/web fresco09:31 paso, pero simulado fallo ASK_CANCELLED y web
  no observo uiLanguage; no nuevo paquete aprobado hasta resolver esas pruebas.
- Ambos procesos OpenCode originales salieron. El usuario indica que pudo
  cerrarlos y AUTORIZA reanudar las mismas conversaciones, no perder contexto.
- QA reanudado con ses_f897bd2d6ffebi2SOYmRbxkSvj en
  term_2ddc11ff-9b88-472c-bc4d-35d3aaa3c5cf; Task task_ece7dd44b4fb /
  Dispatch ctx_1f84945c6023 investiga parser/contrato ask simulado.
- Core reanudado con ses_f8952e9faffeSZG4jI3Ai2kw2h en
  term_52b043f2-bd30-4592-a555-40c9881cf1ef; Task task_dd9121ddbd05 /
  Dispatch ctx_df27f2dc0be8 investiga idioma web. Ambos Grok4.6 xAI verificados,
  en background sin focus. Viejos handles exited, no volver a despacharles.
- Scopes separados, sin apps/LLM mientras diagnostican. Solo fixtures si se
  demuestra cambio de contrato; cualquier fix de producto requiere gate.

## Estado inicial

- Rama local main-kukapu: ee2e5da3155adab7d15094d1445be8d1f030941b.
- origin/main-kukapu y rama de automatizacion run6: 8693b5a28e52f6c30b1be7905e9ba4c70942cfa7.
- Padres de ese merge: ee2e5da315 y d53cbed43f (upstream/main observado).
- El reflog de origin/main-kukapu registra update by push a las 05:12:15 UTC
  del 2026-09-07. Eso no actualizo el worktree principal.
- Referencias remotas aun pendientes de actualizar mediante fetch; estos
  valores describen las referencias locales inspeccionadas, no un sondeo remoto.

## Checkpoint Y Objetivos Fijados

- Primer merge REGISTRADO: `dfc86dbbc3787d43c447e7c5f90939c27a1afa03`, padres
  checkpoint3c91f86317 y automatizacion8693b5a28e. Verificacion4080tests/10skip,
  Node/CLI/web0 y calidad0; hook normal completado, sin push.
- Segundo merge EN CURSO contra314506003a. Unico conflicto textual: lockfile de
  node-pty1.1.0; hash del parche combinado
  `5fc60ea713076145980604fa741bdcc42bfc31386f7410a97d25bc9ba03040d7`, coherente
  en patchedDependencies/importer/snapshot. No es windows-process-tree.
  Parseo unified diff y tests de parche verificados; apply contra tarball
  pristino no disponible, no se ha descargado ni instalado nada.
- Ultima bateria ampliada, tras adaptar las dos fixtures:822files verdes y1skip,
  8533tests verdes/20skip; Node/CLI/web0. B task_28c8f27fa280/ctx_9d28ebb24597
  terminado: se ejecuta scope real en fixture y se habilita el ajuste experimental
  explicito para probar adoption replay; no se debilitan guards de producto.
- A activo task_be1075949e3b / ctx_0b1b7cb1599f endurece instalador EXTERNO
  persistente (transaccion/coherencia/lock/stagedhash y tests sin efectos),
  tras revision inicial. Nunca ejecutar instalacion desdeOrca.
  Ningun worker puede stagear/commitear. Ambos Grok4.6 xAI.

### Historial Del Primer Merge

- Commit local de proteccion creado: `3c91f86317628ee2758745750a03adb4b09ab93e`.
  168 archivos, hook normal completado (oxlint, React Doctor y oxfmt), arbol
  limpio comprobado despues. No push. lint-staged creo y limpio su backup
  automatico durante el hook; no se uso stash manual para trasladar el trabajo.
- package.json recuperado byte a byte de ee2e5da315; la version de entrega se
  inyecta por ORCA_LOCAL_BUILD_VERSION, no mediante un manifiesto truncado.
- Fetch acotado completado: origin/main-kukapu sigue en
  `8693b5a28e52f6c30b1be7905e9ba4c70942cfa7`; upstream/main avanzo a
  `314506003a16297006225147fef8bdcec2186da8` (11 commits posteriores).
- Merge de origin iniciado con `--no-commit --no-ff`: 25 paths en conflicto,
  incluidos tres modify/delete por reorganizacion RPC. El merge de los 11
  commits posteriores se hara despues de cerrar este primer paso.
- Worker A: task_f71ceed62fad / ctx_241ae4cd035a, RPC/CLI y migracion de rutas.
- Worker B inicial: task_c3f83ffb1ae9 / ctx_be0b660af015 entregado. Seguimiento
  transcript task_08b17ec3d9f3 / ctx_562b47e7f5c1 entregado; ACTIVO
  task_880619622f27 / ctx_a2bfb8a23709 para corregir ocupacion remota ante
  stalled/stop sin confirmacion, en el mismo terminal. No dar el pane por libre
  por un error ni por solicitar stop. Ambos workers Grok4.6 xAI, sin mutaciones Git.
  Principal controla indice, commits, docs/config y gates de verificacion.
- Primer typecheck diagnostico: 5 errores Node (3 en contratos de transcripcion
  de B, 2 en RPC de A), no gate final. CLI/web sin errores en esa ejecucion.
  No apps/builds mientras se estabiliza el merge ni atribuir fallos a otra
  area antes de reproducir con la fuente congelada.
- Segundo typecheck conjunto 08:26 UTC: Node/CLI/web exit 0. A debe cerrar
  migracion y declarar code-ready; B debe cerrar el residual de ocupacion.
  Pendiente prueba conjunta/revision, no merge commit todavia. Revisar ademas
  el pin SQLite/sourceDigest frente al cursor nuevo de upstream (mensaje a A).

## Anomalia del manifiesto

package.json carece de scripts y devDependencies y tiene version .2. Su JSON
coincide exactamente con package.json del ASAR empaquetado. El mtime coincide
con la inspeccion del paquete final del 2026-09-06. El comando asar extract-file
escribe el basename del archivo extraido en el cwd, no es una lectura inocua.
La coincidencia identifica un manifiesto de distribucion en el lugar del de
desarrollo; no se considera una eliminacion intencional de las herramientas.

El primer intento de commit fue rechazado por el hook normal: pnpm detecto
parches sin dependencia declarada debido al manifiesto reducido. No se salto el
hook. Antes de corregirlo se guardo el snapshot binario del indice completo en
`dist/checkpoint-before-upstream-20260907.patch`, SHA256
`0d30173206e8660426a3c008875e5f08f0d47d1effdce7f06a51938bdfa09279`.
Este archivo conserva tambien el manifiesto encontrado. Se recuperan los campos
de desarrollo desde la base conocida antes de repetir el commit. Para
inspecciones posteriores usar la API ASAR en memoria o un cwd temporal, nunca
extraer sobre la raiz del proyecto.

## Inspeccion de la automatizacion

run6 conserva cambios del fork frente a upstream y resuelve el traslado de
metodos RPC a `methods/orchestration/{worker,federation,messaging}`. La
recomendacion es integrar primero origin/main-kukapu, conservando ese trabajo,
y despues cualquier avance adicional comprobado de upstream/main. El antiguo
run5 ya es ancestro; no hay que repetirlo. Informe de inspeccion:
`/tmp/opencode/upstream-sync-sep7-inspection.md`.

## Secuencia y limites

1. Auditar contenido candidato y archivos nuevos: no secretos ni artefactos.
2. Crear checkpoint local y registrar su hash; no saltar hooks.
3. Corregir el manifiesto de desarrollo sin perder el snapshot inicial.
4. Fetch acotado de origin/main-kukapu y upstream/main, fijar hashes de destino.
5. Integrar el trabajo util de la automatizacion y upstream sin duplicarlo.
6. Resolver conflictos por comportamiento, verificar y reconstruir .2.
7. Conservar el candidato anterior identificado por hash y entregar el nuevo
   junto con instrucciones de instalacion externa y rollback.

No borrar/mover worktrees de automatizacion ni modificar sus archivos.
Inspeccionarlos mediante refs nombradas desde el worktree principal. No usar
reset/checkout destructivos ni rebase para sustituir la historia del fork.
