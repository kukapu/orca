# Continuar Integracion Y Entrega 197.2

Checkpoint de continuidad solicitado por el usuario antes de limpiar el contexto.
Capturado inicialmente el 2026-09-07 a las 10:16 UTC. La reconciliacion siguiente
prima sobre esa captura y los informes historicos; comprueba el estado real al volver.

## Cierre Postinstalacion (2026-09-07)

- El usuario termino la instalacion EXTERNA. Verificado: `orca --version` .2,
  `/opt/orca/VERSION` .2, runtime `b0c74bff-13d3-4ca5-906b-bc361f02372b`
  `ready`, distinto del runtime .1 anterior. Ambos servicios active.
- SHA-256 de `/opt/orca/orca-linux.AppImage` identico al candidato fechado:
  `4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483`.
  No se repitio build/pack ni se ejecuto instalacion/restart desde el coordinador.
- Tras el reinicio, run-current devolvia null. Recuperado el MISMO Run
  `run_3bc1b0c65acb` mediante run-use, sin recrearlo: generacion 2,
  coordinador `term_29e3c00e-02d7-4993-a341-877f65e35942`. No relanzar workers
  por los handles historicos anteriores al reinicio.
- Automatizacion existente `3eb73380-5393-4ded-bc72-340a137008f6`:
  `model=openai/gpt-6-astra` FIJADO y comprobado por lecturas posteriores;
  OpenCode, effort null, enabled true, base `origin/main-kukapu`, new_per_run,
  fresh session. Prompt/precheck identicos al documento canonico con aserciones.
- Horario/nextRunAt/owner/proyecto conservados. Proxima ocurrencia:
  2026-09-08 05:00 UTC / 07:00 Madrid. Postiz sin cambios. No se ejecuto runNow,
  no hubo llamada LLM ni se creo automatizacion o worker duplicado.
- Flujo y prompt publicados previamente en `cb1c108caa`; este cierre documental
  no cambia las fuentes del AppImage (`42ab555177`). Base de Orca conservada
  tras reiniciar: `origin/main-kukapu`.
- Asignacion completada; no volver a aplicar instalacion o modelo como tareas
  pendientes. La primera corrida programada debe aportar evidencia del modelo
  efectivo. Quedan fuera de este cierre el ajuste DST y la discrepancia staged
  de la UI; cambiar base o reiniciar no demuestra que esta ultima este resuelta.

## Historial Del Cambio De Flujo (2026-09-07)

El usuario autorizo el push posterior a la entrega: `19d1c8836c` ya esta en
`origin/main-kukapu`, comprobado con ls-remote y arbol limpio. Despues decidio:
`main-kukapu` es nuestra rama principal, `origin/main-kukapu` su copia y base
habitual de comparacion; `upstream/main` solo es la fuente oficial que integramos.
No necesitamos PRs ni actualizar `origin/main` para trabajar en el fork.

Solicito documentarlo, adaptar la automatizacion diaria existente y fijar GPT-6
Astra en ese agente. Automatizacion `orca-upstream-sync`, id
`3eb73380-5393-4ded-bc72-340a137008f6`, OpenCode, `new_per_run`, rama
`main-kukapu`, misma autoridad local. NO crear otra ni tocar Postiz.

Bloqueo comprobado: runtime `.1` ignora `model` incluso usando
`node out/cli/index.js automations edit <id> --model openai/gpt-6-astra`.
La respuesta fue ok pero NO guardo el campo. El soporte ya esta en el candidato
`.2` (commit `63a3944846`, integrado). Catalogo local confirma
`openai/gpt-6-astra`. No se cambio config global de OpenCode ni se sustituyo modelo.

El usuario eligio **"Voy A Instalar Ahora"**, desde su terminal externa. No
instalar ni reiniciar nosotros. Si se interrumpe esta conversacion, reconciliar
el mismo Run `run_3bc1b0c65acb` y runtime antes de actuar. Pendiente:

1. Comprobar runtime `ready`, `.2` y runtimeId nuevo despues de SU instalacion.
2. Fijar base de Orca `origin/main-kukapu`; tracking Git ya era correcto.
3. Cambiar default branch GitHub a `main-kukapu` tras revisar automatizaciones:
   habia permiso ADMIN, Actions enabled, pero listado de workflows registrado vacio.
   No activar CI, ejecutar workflows ni modificar otros repositorios.
4. Actualizar prompt/precheck de la automatizacion existente, base remota al dia,
   preservar fork/local concurrente, push normal tras gates y sin tocar checkout
   principal activo ni instalar/empaquetar/reiniciar. Fijar modelo en campo real,
   no solo en prompt, y comprobarlo con automation.show.
5. Mantener horario sin reprogramacion accidental: RRULE actual
   `FREQ=DAILY;BYHOUR=5;BYMINUTE=0`, timezone declarada `Europe/Madrid`, host UTC.
   nextRunAt `1788843600000` = 2026-09-08 05:00 UTC / 07:00 Madrid.
   El calculo actual usa timezone del host; no prometer ajuste DST automatico.
6. Documentar el flujo y resultado, verificar configuracion por lectura. No
   lanzar agentes para probar el modelo, ni repetir build/pack del candidato.

### Aplicado Durante La Espera De Instalacion

- GitHub `kukapu/orca`: default branch cambiada de `main` a `main-kukapu` y
  comprobada con gh. `origin/HEAD` local ahora apunta a `origin/main-kukapu`.
- Orca: `repo set-base-ref` guardo `worktreeBaseRef=origin/main-kukapu` en el
  registro existente. No se crearon repos, proyectos, worktrees o workers.
- Se actualizo el documento canonico `docs/reference/upstream-sync-automation.md`,
  AGENTS.md y las guias de uso. El documento antiguo permitia snapshots de WIP
  ajeno, bypass de hooks y prioridad incondicional upstream: reglas retiradas.
- Prompt y precheck NUEVOS ya aplicados a la automatizacion existente mediante
  CLI y comprobados iguales al documento. Base `origin/main-kukapu`, OpenCode,
  new_per_run/fresh; enabled/horario/owner/proyecto conservados. Postiz intacto.
- Modelo AUN PENDIENTE porque el runtime sigue `.1`. Tras instalacion externa,
  ejecutar `node /tmp/opencode/configure-orca-upstream-sync.mjs`: reutiliza la
  CLI ya compilada, lee prompt/precheck del documento, exige readback y, solo
  con runtime `.2`, fija `openai/gpt-6-astra` sin effort. No compila ni lanza agentes.
  No dar por concluida la asignacion hasta ver `modelAssigned: true`.
- Copia previa de la definicion sin secretos:
  `/tmp/opencode/orca-upstream-sync-before-workflow.json` (solo scratch privado).
  Si no existen los scripts tras retomar, usar `orca automations edit --help`
  de `.2` y la definicion canonica; no usar el helper de un paquete `.1` antiguo.

## Entrega Preparada 2026-09-07 10:44 UTC

- Candidato fechado aceptado; [informe final, comando externo y rollback](./release-delivery-197-2-20260907.md).
  Fuente del artefacto `42ab555177`; despues solo cambia documentacion, no hace
  falta recompilar ni empaquetar por el commit documental de entrega.
- QA `task_a8940ca78f6f` / `ctx_2d3e87622e42` termino `succeeded` a las
  10:40:57Z; `msg_e896503a1d49` recibido y ACK `delivery_94b2b97544e7`.
  Core `task_e438ae748d46` / `ctx_240d3cd2ef45` ya terminado. Ambos siguen
  `retained/external`: conservar sus conversaciones para el usuario, no cerrar
  terminales ni crear workers sustitutos. Inventario: ningun Dispatch dispatched.
- Verificacion final del coordinador: AppImage real, CLI `.2`, runtime propio
  `10d69f91-1ba8-4fb4-a1d7-ad9f16d60edc`, metadata en HOME privado coincidente
  con status/PID, HTTP 200, SIGTERM exit 0, PID `exited`, puerto liberado y HOME
  eliminado. Solo queda el Xvfb de produccion. [Evidencias](./artifact-smoke-197-2-20260907.md).
- Produccion comprobada despues: `.1`, runtime original `ready`. No apply,
  sudo, instalacion, restart de produccion ni push. Hashes de ambos artefactos,
  metadata y ASAR comprobados con aserciones; preflight exit 0 sin mutaciones.
- Siguiente accion autorizada: commit LOCAL de estos informes e indices con
  hooks normales (`docs(release): prepare verified kukapu.2 external handoff`),
  comprobar arbol y comunicar su hash al usuario. Si el commit ya existe en
  `git log -1`, no repetirlo. Despues, esperar instalacion externa del usuario.
- Tras instalacion: reconciliar este MISMO Run con el runtime nuevo y comprobar
  version `.2`, salud y datos. No reutilizar ciegamente handles de procesos que
  el reinicio haya terminado. No repetir smoke LLM, Docker o compactacion como
  pasos implicitos: siguen fuera del alcance.

## Reconciliacion 2026-09-07 10:23 UTC

- Mismo Run `run_3bc1b0c65acb`, coordinador y runtime de produccion; `orca status`
  confirma `ready`, `appVersion: 1.4.197-kukapu.1`. No instalacion ni reinicios.
- HEAD sigue `42ab555177`, 16 commits locales por delante de origin/main-kukapu.
  Upstream `314506003a` y checkpoint `3c91f86317` son ancestros comprobados otra vez.
  Cambios al retomar: este checkpoint nuevo, enlace en el informe de integracion,
  informe de entrega nuevo y actualizacion de la release. Ningun cambio de codigo.
- Pack `task_19e4cf213f8f` / `ctx_ab0df039ab27` termino `succeeded` a las 10:19:47Z.
  Recibido `msg_68e8cdfdbb31`, ACK `delivery_f59520715b0a`. No se repitio build/pack.
  Su reportPath de mensaje era antiguo; el informe real es
  [release-delivery-197-2-20260907.md](./release-delivery-197-2-20260907.md).
- Hashes recalculados por el coordinador: AppImage
  `4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483`;
  deb `ef7b6602c836f1a2d6ab1b0dbab20e395171c7629d385650bf8702a6d7501c67`.
  El informe tenia el SHA-256 del deb mal transcrito; Core lo corrige.
  `package.json` conserva el hash esperado de la captura inicial.
- Nuevas Tasks, MISMAS conversaciones/terminales, sin duplicados; modelo actual
  confirmado por TUI en ambos: Muse Spark 1.3 Contributor OpenCode Go.
  QA `task_a8940ca78f6f` / `ctx_2d3e87622e42`: smoke LOCAL del artefacto sin LLM,
  HOME/runtime privado, sin rebuild; unico informe editable
  `docs/features-kukapu/artifact-smoke-197-2-20260907.md`.
  Core `task_e438ae748d46` / `ctx_240d3cd2ef45`: contrastar hashes, ASAR,
  production bundles y logs existentes; solo edita informe de entrega y release.
  Ambos enviaron heartbeat `investigating`, no solo `input_accepted`.
- El coordinador ejecuto el instalador original UNICAMENTE con `--preflight`,
  artifact fechado y hash anterior: exit 0, `mode=preflight (no mutation)`,
  `cgroup_blocked=yes`, `orca_env_blocked=yes`. Nunca `--apply`.
- Siguiente gate: recibir y revisar ambas entregas, ACK del lote, documentar
  smoke/limites, actualizar indices y commitear SOLO documentacion revisada.
  Entregar comando externo exacto y rollback; instalacion reservada al usuario.

### Seguimiento 10:35 UTC

- Core `ctx_240d3cd2ef45` termino `succeeded` a las 10:26:40Z;
  ACK `delivery_b9f79bd0ae74`. Su afirmacion de hash deb coincidente era
  incorrecta: verificador del coordinador encontro 52 caracteres en el informe,
  no 64. El coordinador corrigio tabla y afirmacion; la comprobacion automatica
  posterior de hashes/bytes/yml/ASAR paso. No hubo que modificar el artefacto.
- QA sigue en `ctx_2d3e87622e42`. Probes iniciales NO aceptados: help/version
  con entorno ORCA heredado y exit oculto por pipeline; serve privado perdio
  DISPLAY y trato de obtener :99, rechazo con exit 1. No ready ni smoke verde.
  El coordinador pidio pausar solo el turno y leer instrucciones de seguridad,
  sin revocar el Dispatch ni cambiar modelo/sesion. QA confirmo lectura de
  `msg_d9ea5cf7c789` por heartbeat a las 10:34Z (ACK `delivery_a46a39b30fe9`).
  Exigir HOME nuevo, allowlist, DISPLAY del Xvfb propio >=100 y JSON sanitizado.
- Servicios de produccion comprobados despues del probe rechazado:
  server PID 2085131, inicio 2026-09-05 06:09:33 UTC; Xvfb PID 3783379,
  inicio 2026-09-04 07:10:58 UTC. Ambos active/running, sin reinicio.
- Inventario del Run: solo QA activo tras finalizar Core. Conserva una Task
  historica blocked (`task_0d875b9de120`, reporte rechazado; reemplazada por la
  revision aceptada `task_c194548fb479`) y E2E fallido historico
  `task_b9d6a2496cea`, sustituido por recheck verde `task_dbdbd733c115`.
  No cambiar esos resultados a verdes ni relanzarlos. Sin gates pending.

## Captura Inicial (Historica)

## Objetivo Y Decisiones

- Terminar el candidato 1.4.197-kukapu.2 incorporando upstream, verificarlo y
  entregar al usuario el comando de instalacion externa con hash y rollback.
- La instalacion la ejecuta EL USUARIO desde una terminal fuera de Orca. Nunca
  instalar, ejecutar sudo, reiniciar servicios ni publicar desde esta sesion.
- El usuario autorizo commits LOCALES de proteccion, merges y correcciones.
  No push, force, rebase, reset destructivo, descarte de cambios o bypass de hooks.
- Modelo vigente de ambos workers: opencode-go/muse-spark-1.3-contributor,
  elegido por el usuario para ahorrar en preparacion/diagnostico de pruebas.
  Los E2E actuales son simulados y no hacen llamadas LLM. No autoriza usar otro
  proveedor ni copiar OAuth/credenciales globales para un smoke real.
- Mejorar compactacion de OpenCode queda PENDIENTE y no bloquea esta entrega.
  /compact manual puede terminar el turno sin continuacion; no autoenviarlo ni
  prometer reanudacion automatica. El usuario esta limpiando el contexto ahora.

## Repositorio Y Proteccion

- Worktree primario: /home/kukapu/dev/projects/orca; rama main-kukapu.
- HEAD comprobado: 42ab555177. Antes de crear este checkpoint el arbol estaba
  limpio y la rama iba 16 commits por delante de origin/main-kukapu. Sin push.
- 3c91f86317: checkpoint de todo el trabajo previo.
- dfc86dbbc3: merge de la automatizacion origin/main-kukapu 8693b5a28e.
- 5d0550794f: merge de upstream/main hasta 314506003a (11 commits posteriores
  a la automatizacion). Ese upstream y el checkpoint son ancestros verificados.
- 99f43d2e4b: instalador externo protegido, con pruebas sobre senuelos.
- 42ab555177: adaptaciones de fixtures E2E y documentacion de continuidad.
- La automatizacion de las 07:00 SI habia pusheado su merge al remoto, pero el
  worktree principal no lo habia incorporado. Se aprovecharon sus resoluciones.
- Se conserva dist/checkpoint-before-upstream-20260907.patch, SHA256
  0d30173206e8660426a3c008875e5f08f0d47d1effdce7f06a51938bdfa09279.
- package.json fue sobrescrito accidentalmente con el manifiesto del ASAR
  durante una inspeccion anterior. Se recupero el manifiesto de desarrollo;
  nunca volver a usar asar extract-file sobre el cwd del repo. Usar API en
  memoria o scratch. Hash actual esperado de package.json:
  c6e53d7433f5ee68a806649a218444889e6a6677fad27a1ce5db8b39a7cc121c.

## Run Y Workers Vigentes

- Run: run_3bc1b0c65acb.
- Coordinador: term_a2512d57-94bc-41c6-9d7f-372ba6691d07.
- Runtime de produccion: 3aae6f99-a1d9-4c8f-87e9-579518628130, .1. El servicio
  orca-server.service aloja este coordinador y los workers en el mismo cgroup.
- Core ACTIVO: term_52b043f2-bd30-4592-a555-40c9881cf1ef.
  Task task_19e4cf213f8f / Dispatch ctx_ab0df039ab27: compilar y empaquetar
  el candidato post-upstream. Ultimo worker-show: dispatched, live, exactWorker
  true, sin pregunta bloqueante. La fase input_accepted no demuestra finalizacion.
- QA disponible: term_2ddc11ff-9b88-472c-bc4d-35d3aaa3c5cf.
  Ultima Task task_dbdbd733c115 / Dispatch ctx_54f7effd832e termino con exito.
  Reutilizar su terminal con una NUEVA Task para verificar el artefacto.
- El usuario cerro los procesos antiguos y autorizo reanudar SUS MISMAS
  conversaciones: Core ses_f8952e9faffeSZG4jI3Ai2kw2h; QA
  ses_f897bd2d6ffebi2SOYmRbxkSvj. No crear conversaciones nuevas por perdida de
  contexto. Los handles viejos term_c8d7944a-1309-4a3b-8643-1386004360e8 y
  term_3f02f8bc-2e36-447d-971f-d502a60ee8cb estan exited, no usarlos.
- Al Core se envio msg_84063fb6c34c: terminar solo la operacion autorizada,
  conservar outputs/reportar y esperar gate; no cancelar build ni iniciar smoke.

## Verificado Hasta Ahora

- Runtime/proveedores: 8533 tests aprobados, 20 omitidos (822 suites verdes y
  una omitida). Node/CLI/web typecheck exit 0.
- Calidad despues de las fixtures: 0 hallazgos nuevos en 228 archivos.
- Instalador: 14 tests verdes, TODOS los caminos apply sobre copias-fixture
  con destinos temporales; nunca se ejecuto apply del instalador original.
- El hook de commit actualizo node-pty desde cache (0 descargas) y lo compilo.
  Nuevo hash de patch 5fc60ea713076145980604fa741bdcc42bfc31386f7410a97d25bc9ba03040d7.
  Electron --check-only exit 0 y floor glibc2.31/GLIBCXX3.4.28 verificado.
- E2E post-upstream: simulado1/1 (09:54 UTC), web4/4 (10:01 UTC).
  Informe /tmp/opencode/post-upstream-e2e-recheck-sep7.md.
- Fix del fake: ask --json devuelve envelope {ok,result}; no leer answer en
  el nivel superior ni interpretar un campo ausente como cancelacion real.
- El build web de pruebas necesita VITE_EXPOSE_STORE=true, independiente de
  electron-vite --mode e2e. La ausencia de __store no prueba fallo de idioma.
  Hay que reconstruir production SIN ambos mecanismos antes de entregar.
- Se corrigio el aislamiento: eliminar variables ORCA_* de source/overlay que
  pueden apuntar fuera del HOME privado. Usar los helpers actuales, no un env
  parcial inventado. Auditoria anterior acoto el instalador Pi a tres extensiones
  gestionadas; no restaurar/borrar globales sin baseline/autorizacion.
- El smoke real OpenCode/Pi de ayer paso ANTES de este upstream. No presentarlo
  como un smoke LLM del candidato de hoy. No hay credenciales temporales vigentes.

## Empaquetado En Curso

Core tiene autorizado production relay/CLI/Electron/web y AppImage+deb con:

```text
ORCA_LOCAL_BUILD_VERSION=1.4.197-kukapu.2
ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1
output=dist/release-1.4.197-kukapu.2-20260907
--publish never
```

- Esa carpeta YA EXISTE con AppImage, deb, latest-linux.yml y linux-unpacked,
  pero al capturar este checkpoint NO habia reporte de finalizacion ni hashes
  finales verificados. Existir no significa estar completo. No repetir el pack.
- El informe esperado docs/features-kukapu/release-delivery-197-2-20260907.md
  aun NO existia. Puede aparecer mientras se limpia el contexto.
- Core puede actualizar ese informe nuevo y docs/releases/v1.4.197-kukapu.2.md.
  No toca src/config/package/lock ni Git. Conserva artefactos de ayer en
  dist/release-1.4.197-kukapu.2; el usuario debe recibir el NUEVO fechado.
- Mantener gates beforeBuild/afterPack, floor glibc2.31, daemon y recursos.
  Sin install-dev-cli, pnpm manual, ensures autofix, descargas/rebuild forzado.
- Verificar que el paquete no incluye dist/test-results/playwright-report,
  que la version interna es .2 y que package.json del repo sigue con su hash.

## Primera Accion Al Reanudar

1. Leer AGENTS.md y docs/uso/README.md, luego git status y este checkpoint.
2. Consultar el MISMO Run sin crear otro:

```text
orca orchestration check --run run_3bc1b0c65acb --json
orca orchestration worker-show --dispatch ctx_ab0df039ab27 --json
```

3. Procesar todo el lote y ACK de su deliveryId despues. Responder preguntas
   por su ID. No asumir que el pack fallo o termino por una espera interrumpida.
4. Si sigue activo, esperar su reporte. Si idle con instrucciones pendientes,
   nudge en SU terminal para leer correo; no relanzar ni duplicar efectos.
5. Tras pack, revisar cambios, hashes/version/ASAR/provenance; autorizar a QA
   un smoke LOCAL del artefacto con entorno minimo y runtime propio, sin LLM.
6. El CLI debe mostrar Usage: orca y version EXACTA .2. No forzar externamente
   ELECTRON_RUN_AS_NODE al launcher: antes se valido Node por error. Serve debe
   demostrar runtimeId distinto, appVersion .2 y dataDir privado, con cleanup.
7. No Docker pull/apt/red para matriz adversarial sin permiso; documentar limite.
8. Completar informe/indice y verificar --preflight del instalador con el NUEVO
   artifact/hash, nunca --apply. Entregar comando exacto al usuario para ejecutar
   fuera de Orca. Commitear localmente los cambios revisados; no push.

## Instalador Externo

config/scripts/install-local-linux-release.sh y
docs/features-kukapu/install-local-linux-release.md estan en99f43d2e4b.
Exige Linux/root/confirmacion para apply, rechaza cgroup/entorno Orca, verifica
hash fuente y stage, usa lock/stages unicos y backups de binario+VERSION.
No revierte bases de datos; el backup de estado debe considerarse por separado.
El usuario ejecutara el comando final desde SSH/consola externa. Nunca desde
este Run, porque reiniciar el servicio mata al coordinador y sus procesos.

## Continuidad

No responder solo con un resumen al recibir el prompt de reanudacion: consultar
estado y seguir el siguiente paso autorizado. No iniciar tareas nuevas hasta
reconciliar las vigentes. No repetir probes fallidos ni cambiar modelo a ciegas.
No leer auth stores ni imprimir capabilities, claves, pairing o ready JSON crudo.
Tests/apps siempre ORCA_BACKGROUND_LAUNCH=1 y Xvfb>=100 cuando proceda, nunca :99
de produccion ni focus/show. Usar apply_patch para ediciones manuales.
