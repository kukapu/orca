# Releases Estables Del Fork

Decision del usuario, 2026-09-08. Sustituye el seguimiento diario de upstream/main.
Esta pagina contiene el prompt canonico de la automatizacion existente.

## Referencias Y Responsabilidad

- `main-kukapu` es la rama principal del fork; `origin/main-kukapu` su copia publicada.
- La fuente automatizada es el tag exacto de una release estable de `stablyai/orca`:
  por ejemplo `v1.4.198`. Nunca integrar la punta de `upstream/main` como atajo.
- `main` y `origin/main` no son bases cotidianas ni intermediarias. No PRs ni pushes
  a upstream. El unico destino de codigo automatico es `HEAD:main-kukapu` en origin.
- Publicar codigo, construir artefactos e instalar son estados distintos. La
  automatizacion prepara y verifica artefactos; NO instala ni reinicia produccion.
- Una release oficial estable no certifica las modificaciones propias del fork.

## Definicion Existente

- Nombre `orca-upstream-sync`, id `3eb73380-5393-4ded-bc72-340a137008f6`.
- Owner: host servidor Orca, no el cliente; proyecto y owner no se retargetean.
- OpenCode con modelo **`openai/gpt-6-astra`**, sin override de effort.
- Nuevo worktree por ejecucion desde `origin/main-kukapu`, sin reutilizar sesion.
- Conservar `FREQ=DAILY;BYHOUR=5;BYMINUTE=0`, timezone Europe/Madrid y dtstart.
  El scheduler actual calcula en UTC: hoy equivale a las 07:00 en Madrid, sin
  garantia de ajuste DST. No cambiar la zona global del servicio.
- Editar la definicion existente; no crear otra ni tocar la de Postiz.

## Precheck Sin Escrituras

`config/scripts/upstream-release-precheck.mjs` consulta releases con `gh api` y
metadata con `orca worktree list`. No hace fetch, no modifica el checkout principal
ni crea un worktree cuando no hay una nueva preparacion elegible.

El configurador embebe un bundle ESM del precheck en el comando de la definicion.
No depende de un script del checkout principal ni de la supervivencia de un
worktree temporal. Las opciones embebidas fijan automationId, repoId y
`baselineTag=v1.4.197`: esta ultima es el umbral inicial de version ya entregada,
NO una afirmacion de que el fork antiguo estuviera basado exclusivamente en ese tag.

Selecciona versiones desktop `vN.N.N`, excluye drafts/prereleases y ordena semver.
Usa tambien releases publicadas del fork y preparaciones terminadas como umbral.
Un draft para la misma version impide duplicarla. Paginacion acotada a diez paginas
por repositorio; una respuesta incompleta, error o formato inesperado bloquea.
Exit 0: nueva preparacion elegible; 1: sin trabajo o reconciliacion pendiente;
2: error. Timeout exterior 240 segundos (hasta 21 comandos de 10 segundos).
El scheduler guarda la evidencia; no se convierte un error en novedad.

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

Cualquier preparacion `preparing` o `blocked` impide abrir otra, tambien para una
release posterior. Un worktree legacy sin marker exige reconciliacion supervisada.
No eliminar estos registros al acabar: sustituyen un segundo ledger global.
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
instalada. Sin release nueva y sin recuperacion autorizada: informar y salir.
No repetir build/pack ni declarar salida de procesos por falta de contacto.

3. Registrar antes de trabajo costoso la primera linea del comentario propio:
orca-release-preparation:{"upstreamTag":"<tag>","upstreamOid":"<commit>","state":"preparing"}
Usar orca worktree set --worktree active --comment, conservando debajo el resumen
anterior. Releer metadata completa y claims competidores; solo propietario mas
antiguo por createdAt e id continua. Nunca arrebatar una preparacion existente.
Campos state permitidos: preparing, blocked, prepared, published. Error o
inventario incompleto: bloqueo. No borrar reservas por antiguedad.

4. Fijar TAG exacto validado vN.N.N y OID peeled con git ls-remote upstream.
Desde TU worktree, fetch acotado:
git fetch --no-tags origin refs/heads/main-kukapu:refs/remotes/origin/main-kukapu
git fetch --no-tags upstream "refs/tags/$TAG:refs/tags/$TAG"
Si falla cualquiera, parar. Verificar que tag/OID coinciden antes/despues. Si
main-kukapu local tiene commits no incluidos en origin/main-kukapu, parar.
Alinear solo TU rama con git merge --ff-only origin/main-kukapu; no forzar.

5. Guardar OIDs de HEAD, origin/main-kukapu, tag y merge-base. Revisar log y paths
acotados por ambos lados, tambien solapamientos sin conflictos. Comprobar que
el fork no arrastra upstream fuera del corte estable: mergear un tag antiguo NO
elimina commits posteriores ya integrados. Si la procedencia no se puede
demostrar, bloquear y pedir reconciliacion, no renombrar el build ni resetear.
Integrar solo el OID verificado del tag mediante merge normal, nunca rebase ni
merge upstream/main. Ancestor exit 0/1 es distinto de error. Tag ya integrado no
demuestra build hecha: consultar evidencia y retomar solo etapas pendientes.

6. Preservar requisitos probados del fork; no ours/theirs masivo. Reutilizar
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
state prepared, con commit fuente, version, hashes y evidencia. No dejar preparing
tras terminar; prepared aun no afirma que se haya publicado codigo ni instalado.

9. Commit solo cambios revisados con hooks normales. Artefactos fuera del indice.
Solo tras TODOS los gates, arbol limpio y commit exacto validado: repetir fetch
acotado origin/main-kukapu y comprobar OID remoto original y rama local sin
trabajo inedito. Cualquier avance concurrente bloquea sin descartar/rebasar.
git push origin HEAD:main-kukapu, sin force; comprobar git ls-remote.
Nunca publicar la rama temporal. Crear tag fork v<oficial>-kukapu.N en el commit
validado solo si no existe o coincide. Publicar ese tag solo en origin y crear
release DRAFT en kukapu/orca con gh, --verify-tag, notas y artefactos verificados.
No sobrescribir tags/assets ni duplicar un draft. Registrar SHA y hashes remotos.
Si el push ya ocurrio y falla draft/upload, registrar estado parcial y retomar
solo lo pendiente: no rebuild automatico, rollback Git ni release publica.
Tras verificar codigo/tag y draft con todos sus assets, actualizar el comentario
a state published con SHA remoto, tag y referencia al draft. Conservar evidencia.

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
errores, paginacion, drafts, umbrales y deduplicacion/metadata incompleta. Verificar
el comando embebido real sin lanzar agente y releer definicion tras editar.
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
