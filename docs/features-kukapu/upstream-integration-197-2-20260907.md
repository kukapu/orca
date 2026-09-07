# Integracion upstream para el candidato 197.2

## Autorizacion

El usuario aprueba un commit LOCAL de proteccion antes de integrar upstream,
resolver conflictos y reconstruir el candidato 1.4.197-kukapu.2. No se autoriza
push ni instalacion/reinicio de produccion. La instalacion la ejecutara el
usuario desde una terminal fuera de Orca, con instrucciones y rollback.
La mejora de compactacion de OpenCode queda como pendiente independiente.
ULTIMA ORDEN (2026-09-07 08:13 UTC): queda poca cuota GLM5.3; usar
`xai/grok-4.6` a partir de ahora. Ambos selectores cambiados in-place y footer
Grok4.6 xAI high verificado, sin recrear terminales ni reiniciar el merge.

## Estado inicial

- Rama local main-kukapu: ee2e5da3155adab7d15094d1445be8d1f030941b.
- origin/main-kukapu y rama de automatizacion run6: 8693b5a28e52f6c30b1be7905e9ba4c70942cfa7.
- Padres de ese merge: ee2e5da315 y d53cbed43f (upstream/main observado).
- El reflog de origin/main-kukapu registra update by push a las 05:12:15 UTC
  del 2026-09-07. Eso no actualizo el worktree principal.
- Referencias remotas aun pendientes de actualizar mediante fetch; estos
  valores describen las referencias locales inspeccionadas, no un sondeo remoto.

## Checkpoint Y Objetivos Fijados

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
