# Releases Estables Del Fork

Decision del usuario, 2026-09-08. Sustituye el seguimiento diario de upstream/main.
Esta pagina contiene el prompt canonico de la automatizacion existente.

Para ejecutar una release paso a paso, cargar la skill del repositorio
[orca-fork-release](../../.agents/skills/orca-fork-release/SKILL.md), que reutiliza
este contrato y aporta plantillas de evidencia y reconciliacion manual.

## Referencias Y Responsabilidad

- `main-kukapu` es la rama principal del fork; `origin/main-kukapu` su copia publicada.
- La fuente automatizada es el tag exacto de una release estable de `stablyai/orca`:
  por ejemplo `v1.4.198`. Nunca integrar la punta de `upstream/main` como atajo.
- `main` y `origin/main` no son bases cotidianas ni intermediarias. No PRs ni pushes
  a upstream. El unico destino de codigo automatico es `HEAD:main-kukapu` en origin.
- Publicar codigo, construir artefactos e instalar son estados distintos. La
  automatizacion prepara y verifica artefactos; NO instala ni reinicia produccion.
- Una release oficial estable no certifica las modificaciones propias del fork.

### Fuente Canonica Y Puente De Publicacion

Autorizacion explicita del usuario, 2026-09-08, tambien para publicaciones futuras
necesarias: `git merge -s ours` SOLO como puente de historial, no para resolver
codigo. C es el commit fuente limpio, validado y construido desde linaje estable;
`sourceTag=v<oficial>-kukapu.N` apunta a C, nunca a P. F es el OID publicado de
`origin/main-kukapu` capturado y revisado. P es el puente con exactamente dos
padres ordenados C,F y `tree(P)=tree(C)`, antes y despues de hooks normales.
Publicar P permite fast-forward desde F sin force, sin reintroducir extras del
antiguo main-tip ni incluir una rama vieja de automatizacion como tercer padre.

El historial de P incluye cambios upstream excluidos del arbol de C. Por eso un
merge oficial futuro desde P puede omitir una feature B que Git ya cree integrada.
El siguiente candidato nace del ultimo sourceTag/sourceCommit verificado, no de P.
Esto NO autoriza perder cambios propios posteriores: revisar el diff y commits
desde la ultima publicacion P hasta el F actual y portar explicitamente los commits
propios necesarios a la fuente antes del merge upstream normal. Cambios desconocidos,
dependencias ambiguas o ausencia de esa evidencia bloquean; no descartarlos ni
declarar exito «sin novedades» para ocultarlos.

### Reconciliacion Manual De Una Base Aceptada

Si faltan evidencias de una entrega anterior, el usuario puede aceptar
explicitamente su version operativa como base de una preparacion manual. Antes
de integrar, registrar la decision y verificar sourceTag/C, tag/OID oficial,
linaje estable, puente P, arboles y todos los cambios propios posteriores. Seguir
la [guia de reconciliacion](../../.agents/skills/orca-fork-release/references/reconcile-release.md).

La aceptacion permite continuar manualmente desde la fuente reconciliada sin
reconstruir la entrega historica solo para rellenar registros. No certifica gates,
hashes ni procedencia del binario instalado; no permite crear markers terminados
o manifiestos ficticios. La nueva release debe completar todos sus gates.
Concurrencia, ejecuciones `unverifiable` y cambios desconocidos siguen bloqueando.
El precheck automatico conserva su contrato estricto hasta disponer de procedencia
durable valida; esta excepcion manual no altera su selector ni la automatizacion.

Decision de base `.200`, 2026-09-15:
[aceptacion y evidencia inicial](../releases/1.4.200-kukapu.1-reconciliation-20260915.md).

## Definicion Existente

- Nombre `orca-upstream-sync`, id `3eb73380-5393-4ded-bc72-340a137008f6`.
- Owner: host servidor Orca, no el cliente; proyecto y owner no se retargetean.
- OpenCode con modelo **`openai/gpt-6-astra`**, sin override de effort.
- Nuevo worktree por ejecucion desde `origin/main-kukapu` solo como contenedor,
  sin reutilizar sesion. Crear dentro una rama candidata nueva desde la fuente
  canonica, no continuar la rama historica que el scheduler entrega.
- Conservar `FREQ=DAILY;BYHOUR=5;BYMINUTE=0`, timezone Europe/Madrid y dtstart.
  El scheduler actual calcula en UTC: hoy equivale a las 07:00 en Madrid, sin
  garantia de ajuste DST. No cambiar la zona global del servicio.
- Editar la definicion existente; no crear otra ni tocar la de Postiz.

## Precheck Sin Escrituras

`config/scripts/upstream-release-precheck.mjs` consulta releases con `gh api` y
metadata con la CLI instalada (`options.orcaCli`, ruta absoluta; default `orca`).
En este host se fija `/home/kukapu/.local/bin/orca-ide`, fuera de los worktrees.
El comando embebido fija tambien el Node24 existente por ruta absoluta: el PATH
del servicio no contiene `node`. No modificar PATH global ni depender del login
shell del coordinador. Verificar con HOME/PATH efectivos del servicio.
No hace fetch, no modifica el checkout principal
ni crea un worktree cuando no hay una nueva preparacion elegible.

El configurador embebe un bundle ESM del precheck en el comando de la definicion.
No depende de un script del checkout principal ni de la supervivencia de un
worktree temporal. Las opciones embebidas fijan automationId, repoId y
`baselineTag=v1.4.197`: esta ultima es el umbral inicial de version ya entregada,
NO una afirmacion de que el fork antiguo estuviera basado exclusivamente en ese tag.

Selecciona versiones desktop `vN.N.N`, excluye drafts/prereleases y ordena semver.
Usa preparaciones terminadas y manifiestos de release con procedencia valida como umbral. Las releases del
fork no inventan otra fuente ni elevan por si solas el highwater: una publicacion
sin inventariar posterior a la ultima fuente valida bloquea como
`unknown-source-lineage` (tambien una revision kukapu.N mayor de la misma oficial).
Las entregas historicas anteriores no invalidan una fuente canonica posterior.
Un draft para la misma version impide duplicarla. Paginacion acotada a diez paginas
por repositorio; una respuesta incompleta, error o formato inesperado bloquea.
Exit 0: nueva preparacion elegible; 1: sin trabajo o reconciliacion pendiente;
2: error. Timeout exterior 240 segundos (hasta 22 comandos de 10 segundos).
El scheduler guarda la evidencia; no se convierte un error en novedad.
Para lanzar exige fuente canonica al menos tan reciente como baselineTag; si falta,
`canonical-source-required`. El baseline 197 NO permite bootstrap automatico.
La reconstruccion 198 fue verificada, publicada e instalada; su manifiesto durable
permite continuar aunque se retire el workspace de preparacion.

### Procedencia Durable En GitHub

Cada entrega terminada conserva `orca-release-provenance.json` como asset de su
release del fork, incluso si la release sigue en draft. El precheck descarga como
maximo UN manifiesto: el de mayor version oficial y revision kukapu.N que lo tenga.
Un manifiesto seleccionado invalido bloquea; no se retrocede silenciosamente.

Contrato: `schemaVersion=1`, `repository=kukapu/orca`,
`upstreamRepository=stablyai/orca`, `state=published`, campos de procedencia C/P
descritos abajo, `sourceTree` y `artifacts: [{name,size,sha256}]`. No incluir rutas
locales, IDs de automatizacion, datos de instalacion privados ni secretos. El JSON
no se incluye a si mismo en artifacts; puede referenciar los binarios, metadata de
actualizacion y checksums ya subidos, sin inventariar assets ajenos.

Se verifican size y digest SHA256 de GitHub contra los bytes originales del JSON
antes de parsear (maximo64KiB), tag/repo/version y cada artefacto declarado contra
los metadatos remotos uploaded/size/digest. Una fuente local contradictoria bloquea.
Una entrega posterior sin inventariar tambien bloquea, aunque exista un manifiesto
anterior valido. No hay descarga de binarios ni fan-out de un asset por release.
Esta comprobacion no sustituye verificar los objetos Git y arboles antes de integrar.

### Preparaciones Persistentes

Reutilizar el comentario de metadata del worktree propietario. Primera linea:

```text
orca-release-preparation:{"upstreamTag":"v1.4.198","upstreamOid":"<commit>","state":"preparing"}
```

Estados: `preparing`, `blocked`, `prepared`, `published`. Conservar debajo el
resumen humano y la referencia a evidencia previa. `prepared` requiere artefactos
verificados; `published` requiere comprobacion remota. Ninguno significa instalado.
El informe separa tag/OID oficial, commit integrado, build/hashes y versiones
instaladas conocidas (o no comprobadas). No deducir instalacion de `package.json`.

Contrato de campos del marker terminado (`prepared` o `published`):

- `upstreamTag`: tag oficial estable exacto `vN.N.N`; `upstreamOid`: commit peeled.
- `forkVersion`: `<oficial>-kukapu.N` sin `v`, N entero positivo sin ceros iniciales.
- `sourceTag`: exactamente `v${forkVersion}`, con la misma version que upstreamTag.
- `sourceCommit`: C, commit peeled del sourceTag y fuente exacta de gates/artefactos.
- `publicationCommit`: P, opcional en `prepared`, solo se anade tras crear y
  verificar el puente; obligatorio en `published`. Nunca sustituye sourceCommit.
- OIDs: cadenas hexadecimales completas de 40 o 64 caracteres. Hashes de artefactos,
  inputs y evidencia humana se conservan debajo del marker, no los certifica el parser.

Los estados `preparing`/`blocked` pueden carecer de fuente mientras se reconcilian;
si contienen campos de procedencia, deben ser validos. Markers terminados sin
procedencia, malformados o contradictorios para un sourceTag: `reconcile-legacy`.
El precheck elige la maxima fuente valida por semver oficial y despues N numerico.
Devuelve `sourceTag`, `sourceCommit`, `forkVersion`, `sourceUpstreamTag`,
`sourceUpstreamOid` y, si existe para esa fuente, `publicationCommit`, ademas de
`upstreamTag` objetivo y `highwaterTag`. No expone comentarios/evidencia privada.
Esto valida metadata, NO existencia del tag, ancestry, arboles ni artefactos: el
agente debe verificarlos antes de usarla. No cambiar el bundle opaco ni su entorno
de dependencias al ejecutar el precheck; el coordinador lo recompila al configurar.
`already-covered` solo compara versiones; no certifica ausencia de cambios propios
posteriores en main-kukapu. Su revision Git sigue siendo un gate del agente.

Cualquier preparacion `preparing` o `blocked` impide abrir otra, tambien para una
release posterior. Un worktree legacy sin marker exige reconciliacion supervisada.
Mientras haya trabajo activo o bloqueado, no retirar el registro. Una preparacion
publicada puede retirarse por el usuario solo despues de verificar su manifiesto
remoto, preservar evidencia fuera y comprobar recuperacion sin su metadata local.
No es necesario conservar un workspace temporal para siempre ni crear un ledger global.
Un inventario incompleto o inaccesible bloquea, no prueba que no exista trabajo.

El precheck es solo lectura, no un lock. El owner unico del scheduler serializa
el lanzamiento programado. El agente registra su claim y relee los competidores
antes del trabajo costoso; ante claims multiples solo continua el mas antiguo por
createdAt e id. Un lanzamiento manual omite el precheck: debe repetir estas
comprobaciones y no sirve como prueba inocua de configuracion. Una recuperacion
de un propietario con ejecucion `unverifiable` requiere coordinacion explicita.

## Prompt

```text
Eres el agente de preparacion de releases estables del fork kukapu/orca (origin)
desde stablyai/orca (upstream). Politica autorizada el 2026-09-08: NO seguir la
punta upstream/main. Lee AGENTS.md, docs/uso/README.md y el procedimiento de
release del fork. Si el checkout conserva instrucciones antiguas de sincronizar
main, este prompt las sustituye. Trabaja solo en tu worktree asignado.

Conserva la automatizacion existente, modelo fijado openai/gpt-6-astra, effort
sin override, base origin/main-kukapu y owner. Verifica definicion y evidencia
efectiva del modelo; si discrepan, detente. No configuracion global ni copiar
credenciales. No elegir otro proveedor. No PRs ni pushes a upstream/origin main.
La base del scheduler es SOLO contenedor: la rama candidata nace de sourceTag/C,
nunca del contenido ni historial de la rama de publicacion.

1. Reconciliar workspace, Run, historial, preparaciones y ejecucion en el host
propietario. Usa metadata Orca; no leas ni modifiques otros checkouts. Un run
completed no demuestra ni proceso exited ni release preparada. Ante trabajo
live o unverifiable, bloqueado o ya preparado para esa release, no duplicar.
Conservar conversaciones, ramas, worktrees y artefactos. Revisar status/rama/HEAD,
remotos y operaciones Git pendientes; no tocar cambios ajenos.

2. Consultar releases oficiales con gh --repo stablyai/orca o gh api con repo
explicito. Solo releases publicadas, no draft ni prerelease, tags vN.N.N.
Comparar contra la ultima base oficial preparada y las releases del fork,
incluidos drafts pendientes. No comparar solo package.json ni la version
instalada. Repetir el contrato del precheck: marker terminado exige upstreamTag,
upstreamOid, forkVersion, sourceTag y sourceCommit validos; published exige ademas
publicationCommit. No elevar el umbral por releases sin procedencia inventariada.
Seleccionar maxima fuente por oficial/N; sin fuente canonica no hay bootstrap
automatico desde baseline197, main ni checkpoint. La primera 198 es reconciliacion
supervisada. Revisar tambien cambios propios posteriores a la ultima publicacion:
si no estan clasificados, bloquear incluso sin release nueva. Solo sin cambios
pendientes, release nueva ni recuperacion autorizada: informar y salir.
No repetir build/pack ni declarar salida de procesos por falta de contacto.
Recuperar procedencia de orca-release-provenance.json en la release del fork si
el workspace anterior ya no existe. Validar sus bytes/size/digest y artefactos,
repositorios y tags; despues verificar Git. No confiar en texto libre de las notas
ni inventar fuente a partir del nombre de version. Usar la CLI instalada del host,
no un out/cli dentro de otro checkout ni un shim temporal.

3. Registrar antes de trabajo costoso la primera linea del comentario propio:
orca-release-preparation:{"upstreamTag":"<tag>","upstreamOid":"<commit>","state":"preparing"}
Usar orca worktree set --worktree active --comment, conservando debajo el resumen
anterior. Releer metadata completa y claims competidores; solo propietario mas
antiguo por createdAt e id continua. Nunca arrebatar una preparacion existente.
Campos state permitidos: preparing, blocked, prepared, published. Error o
inventario incompleto: bloqueo. No borrar reservas por antiguedad.

4. Fijar TAG exacto validado vN.N.N y OID peeled con
git ls-remote upstream "refs/tags/$TAG" "refs/tags/$TAG^{}".
Fijar SOURCE_TAG/SOURCE_COMMIT del ultimo marker o manifiesto canonico y LAST_P de la ultima
publicacion verificada (puede ser anterior a la fuente preparada seleccionada).
Desde TU worktree, fetch acotado y tags nombrados, nunca todas las refs:
git fetch --no-tags origin refs/heads/main-kukapu:refs/remotes/origin/main-kukapu
git fetch --no-tags origin "refs/tags/$SOURCE_TAG:refs/tags/$SOURCE_TAG"
git fetch --no-tags upstream "refs/tags/$TAG:refs/tags/$TAG"
Obtener OIDs remotos peeled de tags nombrados antes/despues y comprobar
git rev-parse "$SOURCE_TAG^{commit}" = SOURCE_COMMIT, NO publicationCommit.
Verificar tambien tag/OID oficial y el tag oficial de la fuente anterior mediante
fetch nombrado si necesario. Si falla algo, parar sin sustituir refs ni forzar.
Guardar F=origin/main-kukapu. Si la rama contenedora tiene trabajo local inedito,
parar. Desde checkout limpio crear git checkout -b "$CANDIDATE" "$SOURCE_COMMIT";
no alinear candidato con main-kukapu ni mezclar una vieja rama de automatizacion.

5. Guardar OIDs de fuente, F, LAST_P, tag y merge-base. Verificar LAST_P ancestro
de F, padres/arbol del puente previo y evidencia de la fuente canonica. Revisar
git diff "$LAST_P" "$F" y log acotado LAST_P..F; portar explicitamente commits
propios posteriores mediante cherry-pick normal y registrar origen/destino y
dependencias antes de integrar upstream. No mergear F a la fuente. Si falta LAST_P
en bootstrap supervisado, exigir inventario completo aprobado; nunca asumir diff
vacio. Ediciones desconocidas o no portadas bloquean, no se descartan silenciosamente.
Revisar log y paths acotados por ambos lados, tambien solapamientos sin conflictos.
Comprobar que el fork no arrastra upstream fuera del corte estable: mergear un tag antiguo NO
elimina commits posteriores ya integrados. Si la procedencia no se puede
demostrar, bloquear y pedir reconciliacion, no renombrar el build ni resetear.
Integrar solo el OID verificado del tag mediante merge normal, nunca rebase ni
merge upstream/main. Ancestor exit 0/1 es distinto de error. Tag ya integrado no
demuestra build hecha: consultar evidencia y retomar solo etapas pendientes.

6. Preservar requisitos probados del fork; no ours/theirs masivo para codigo. La
unica excepcion autorizada es el puente de publicacion del paso 9. Reutilizar
upstream equivalente solo con evidencia. Documentar conflictos y solapamientos.
Revisar dependencias/scripts antes de pnpm install --frozen-lockfile; no
normalizar lockfiles. Usar Node/pnpm requeridos ya disponibles. CI=1, HOME/XDG y
temporales privados para evitar cache Electron git-common-dir y cuentas reales.
No instalaciones globales ni scripts que enlacen orca-dev globalmente.

7. Verificar el candidato exacto: pnpm tc, pnpm test con suites relevantes del
delta/fork y pnpm run check:code-quality:changed con base explicita. Verificar
contratos SSH, folder workspaces, Windows y mixed-version. Cuando el delta cloud
lo requiera, PostgreSQL 16/17 DESECHABLE: nunca DB compartida. Skips no son verde.
Cloud Verify no corre por push a main-kukapu en el YAML heredado: no prometer CI.
Tests/apps siempre ORCA_BACKGROUND_LAUNCH=1, hidden CDP y aislamiento. Xvfb propio
>=100 si necesario; nunca :99, show/focus ni apps visibles. Sin smoke LLM real,
credenciales globales, Docker pull, apt o sudo. Gate imposible seguro: bloqueo.
Maximo 2-3 rondas razonadas de fixes minimos, sin omitir hooks ni desactivar lint.

8. Preparar version <oficial>-kukapu.N sin colision con tags/drafts previos.
Commit de fuente C con hooks normales, solo cambios revisados y artefactos fuera
del indice, ANTES de build. Gates del paso 7 y artefactos deben corresponder al
commit C exacto, limpio; si cambian inputs o hooks, invalidar y repetir gates
afectados antes de declarar prepared. C conserva solo el linaje estable aprobado.
Alcance inicial heredado: Linux x64 AppImage/deb para servidor; no inventar OS o
arquitecturas de clientes. Otras plataformas requieren inventario y runner seguro.
Build production sin flags E2E, flujo node-direct sin instalador CLI global y
pack --publish never. Conservar commit fuente y hashes de inputs/artefactos;
no repetir etapas completas con los mismos inputs. Gate glibc 2.31 sobre binarios,
version ASAR/CLI y exclusiones de secretos/scratch. Smoke de artefacto real:
servidor ready, PTY round-trip, clientes/reconexion y shutdown en aislamiento.
Probar coexistencia con la version anterior entregada; no afirmar desktop real
cuando solo se probaron RPC/web. Backup y rollback se preparan, no se despliegan.
Tras verificar TODOS los artefactos y gates, actualizar el comentario propio a
state prepared, con upstreamTag/upstreamOid, forkVersion, sourceTag y sourceCommit=C,
hashes y evidencia; publicationCommit ausente hasta existir el puente. No dejar preparing
tras terminar; prepared aun no afirma que se haya publicado codigo ni instalado.

9. SOLO tras TODOS los gates/artefactos de C, HEAD=C y arbol/indice limpios:
repetir fetch acotado origin/main-kukapu y comprobar que sigue en F. Cualquier
avance concurrente bloquea sin descartar/rebasar; conservar los cambios para revision.
Guardar TREE_C con git rev-parse "$C^{tree}" y comprobar git write-tree = TREE_C.
Crear puente autorizado desde C: git merge --no-ff --no-commit -s ours "$F".
Antes del commit exigir HEAD=C, MERGE_HEAD=F unico, git write-tree = TREE_C y
working tree sin cambios respecto al indice. Commit puente con hooks normales;
no omitirlos ni amend. Si un hook falla o cambia inputs/arbol, bloquear publicacion.
Capturar P=HEAD; exigir git show -s --format=%P "$P" exactamente "C F" en ese orden,
git rev-parse "$P^{tree}" = TREE_C, git write-tree = TREE_C y checkout limpio.
No aceptar un tercer padre, un no-op de merge, ni C=P. Es SOLO puente de historial:
no reintroducir extras de main-tip y nunca resolver conflictos de codigo con ours.
Registrar publicationCommit=P en prepared solo tras estas aserciones. Si faltan
gates, no crear puente. Repetir comprobacion remota de F inmediatamente antes del push.
Fijar SOURCE_TAG_NEW al sourceTag del candidato, no al de la base anterior.
Crear tag fork v<oficial>-kukapu.N en C (NO P) solo si no existe o peeled coincide;
verificar sourceTag -> C local/remoto. Publicar sin force:
git push origin HEAD:main-kukapu "refs/tags/$SOURCE_TAG_NEW:refs/tags/$SOURCE_TAG_NEW"
Nunca publicar la rama temporal. Comprobar git ls-remote: main-kukapu=P y tag=C.
Crear release DRAFT en kukapu/orca con gh, --verify-tag, notas y artefactos verificados.
No sobrescribir tags/assets ni duplicar un draft. Registrar SHA y hashes remotos.
Si el push ya ocurrio y falla draft/upload, registrar estado parcial y retomar
solo lo pendiente: no rebuild automatico, rollback Git ni release publica.
Tras verificar codigo/tag y draft con todos sus assets, actualizar el comentario
a state published conservando sourceCommit=C/sourceTag, publicationCommit=P,
OID remoto y referencia al draft. Conservar evidencia y el tag canonico para la
siguiente rama candidata; NUNCA arrancarla desde P aunque el contenedor si lo haga.
Antes de dar por terminada la entrega, subir SIN clobber el asset
orca-release-provenance.json con schemaVersion1, repositorios, state published,
upstreamTag/Oid, forkVersion, sourceTag/Commit, publicationCommit, sourceTree y
artifacts[{name,size,sha256}] verificados. No autoreferenciar el JSON, copiar
secretos o incluir rutas privadas. Verificar contenido/digest remotos. Si falta o
contradice la procedencia, entrega parcial bloqueada: no dejar un falso terminado.
Un workspace publicado solo sera prescindible despues de conservar evidencia
necesaria en almacenamiento privado persistente y probar el precheck sin su registro.
No borrar worktrees, sesiones ni ramas automaticamente.

10. Instalacion SIEMPRE separada y autorizada: NO instalar releases, reiniciar
servicios ni actualizar clientes/VPS. No checkout, pull, merge, stage, stash,
snapshot, reset o limpieza en checkout principal ni otros worktrees. Dejar el
eventual fast-forward al coordinador en ventana segura. No eliminar recursos.

11. Ante bloqueo, no publicar. Conservar trabajo/evidencia y marcar state blocked
en comentario propio con motivo y proximo paso; no pasar a prepared por skips.
Informe separa version oficial integrada, fork construido, publicado e instalado
(este ultimo no comprobado salvo evidencia externa). OIDs antes/despues, commits,
conflictos, preservacion fork, gates/comandos/resultados, hashes, limites, push y
draft si/no, checkout principal pendiente. Nunca secretos, capabilities o pairing.
Ejecuta date '+%A, %Y-%m-%d' y cierra con
"Dia y fecha de ejecucion: <resultado>".
```

## Verificacion Y Entrega

Tests del selector/precheck con gh/orca simulados cubren versiones, prereleases,
errores, paginacion, drafts, umbrales, procedencia y deduplicacion/metadata incompleta.
El test source-lineage usa solo un repositorio temporal sintetico, sin hooks ni
red: verifica padres C,F/arbol identico, tag en C y que la feature B de la siguiente
oficial se pierde partiendo de P pero se recupera partiendo de C. Git 2.25 compatible
(init + checkout -b, no init -b); no crea worktrees ni toca el repositorio real.
Verificar el comando embebido real sin lanzar agente y releer definicion tras editar.
Conservar owner, schedule/dtstart, base, modo, modelo y effort; no enviar --trigger
para conservar horario porque el parser recalcula dtstart.

La entrega Linux previa esta en
`docs/features-kukapu/release-delivery-197-2-20260907.md`. Es referencia de
procedimiento, no evidencia sobre un build nuevo. No seguir sus paths absolutos
a otros checkouts. El canal upstream no entrega automaticamente tags kukapu;
la primera entrega del fork queda en draft/manual. Clientes adicionales sin
inventario no se dan por empaquetados ni validados.

El primer cambio de politica conserva el checkpoint main-tip `9a2a3a26ba` del
Run 7. Su historial y el de la base publicada deben compararse con `v1.4.198`
antes de elegir candidato; no se certifica ese checkpoint por cambiarle version.
