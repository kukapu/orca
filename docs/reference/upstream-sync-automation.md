# Flujo Del Fork Y Sincronizacion Diaria

Decision del usuario, 2026-09-07. Esta pagina es la fuente canonica del flujo y
del prompt de `orca-upstream-sync`; mantener documento y automatizacion alineados.

## Ramas Y Referencias

| Referencia | Funcion |
| --- | --- |
| `main-kukapu` | Rama principal de nuestro fork y fuente de versiones propias validadas. |
| `origin/main-kukapu` | Copia publicada en `kukapu/orca`, tracking y comparacion habitual en Orca. |
| `upstream/main` | Punta del repositorio oficial `stablyai/orca`; solo fuente de actualizaciones. |
| `main` / `origin/main` | Referencias opcionales al oficial; no destino de nuestro trabajo ni paso obligatorio. |

La rama predeterminada del fork en GitHub es `main-kukapu`. No borrar ni mover
`main`, no pushear a upstream y no crear PRs automaticamente. Una contribucion
al oficial, si se pide, se prepara aparte desde `upstream/main` con cambios acotados.
No hace falta pasar por `main` local para incorporar upstream, ni seguir tags de
release en lugar de su punta.

En el checkout principal, Git sigue `origin/main-kukapu` y la base de Orca es
`origin/main-kukapu`. Eso distingue sincronizacion pendiente de las diferencias
historicas frente al oficial. Cambiar la base NO demuestra que se haya corregido
una lista staged incorrecta; el indice real se comprueba con Git.

## Automatizacion Existente

- Nombre: `orca-upstream-sync`; id `3eb73380-5393-4ded-bc72-340a137008f6`.
- Host: servidor Orca que posee `/home/kukapu/dev/projects/orca`; no el cliente.
- Agente: OpenCode. Modelo solicitado: **`openai/gpt-6-astra`**, no `-fast` ni
  un modelo homonimo de otro proveedor. Sin override de effort.
- Worktree nuevo por ejecucion desde `origin/main-kukapu`, sin reutilizar sesion.
  Actualizar esta definicion; no duplicarla ni alterar la automatizacion de Postiz.
- Conservar la programacion existente. Siguiente ocurrencia comprobada:
  2026-09-08 05:00 UTC = 07:00 Europe/Madrid.
- Limite del horario actual: el planificador calcula en la zona del proceso
  (UTC en este host), aunque guarda `timezone=Europe/Madrid`. La regla actual
  `FREQ=DAILY;BYHOUR=5;BYMINUTE=0` no garantiza las 07:00 tras el cambio de hora.
  Revisar el ajuste DST por separado; no cambiar la zona global del servicio.

## Prompt

```text
Eres el agente de sincronizacion diaria de kukapu/orca (origin) con el oficial
stablyai/orca (upstream). Lee AGENTS.md, docs/uso/README.md y
docs/reference/upstream-sync-automation.md. Trabaja solo en tu worktree asignado.

La rama principal de nuestro fork es main-kukapu. Tu worktree parte de
origin/main-kukapu, la copia publicada. upstream/main solo aporta actualizaciones.
No uses origin/main como base cotidiana, no actualices main como intermediaria,
no hagas PRs ni pushes a upstream. Sincronizar no es compilar una release,
empaquetar, instalar ni reiniciar produccion.

El modelo de esta automatizacion debe estar fijado a openai/gpt-6-astra en su
definicion de lanzamiento, no solo mencionado en el prompt. Comprueba el modelo
configurado y la evidencia efectiva disponible; si no coincide, detente y reporta.
No cambies configuracion global, copies credenciales o elijas otro proveedor.

1. Reconciliar antes de actuar: identifica workspace, Run y ejecuciones anteriores
de esta automatizacion. No dupliques un trabajo activo o de estado unverifiable.
Revisa git status, rama, HEAD y remotos. Si tu worktree tiene cambios ajenos o una
operacion Git pendiente, no los modifiques. Conserva las conversaciones existentes.

2. Fetch acotado, desde tu worktree:
git fetch --no-tags origin refs/heads/main-kukapu:refs/remotes/origin/main-kukapu
git fetch --no-tags upstream refs/heads/main:refs/remotes/upstream/main
Si falla cualquiera, para. Si existe la rama local main-kukapu con commits no
incluidos en origin/main-kukapu, para y reporta: ese trabajo local tiene prioridad
y necesita una reconciliacion supervisada. No lo sobrescribas ni lo publiques sin
validarlo. Alinea solo TU rama de automatizacion mediante
git merge --ff-only origin/main-kukapu. Si no es fast-forward, no fuerces nada.

3. Guarda los OIDs de HEAD, origin/main-kukapu, upstream/main y su merge-base.
Si upstream/main ya es ancestro de HEAD, informa sin merge ni pruebas repetidas.
Error al comprobar ancestros no equivale a novedad upstream. Revisa un log acotado
y los ficheros modificados por ambos lados desde la base, tambien si el merge
textual fuera limpio. Integra upstream/main mediante un merge normal, sin rebase.

4. Preserva el comportamiento propio y probado del fork al resolver conflictos.
No apliques ours/theirs masivamente ni elimines features propias solo porque
upstream toque el mismo fichero. Reutiliza una implementacion upstream equivalente
solo si verificas que conserva los requisitos del fork; si no puedes demostrarlo,
deja el caso bloqueado para el usuario. Documenta las decisiones y los solapamientos.

5. Verifica el resultado, no solo los conflictos textuales: typecheck pnpm tc,
tests relevantes de cambios y areas solapadas con pnpm test, y
pnpm run check:code-quality:changed. Revisa dependencias y scripts antes de instalar;
si hace falta preparar dependencias, pnpm install --frozen-lockfile. No normalices
el lockfile ni ejecutes instaladores globales como efecto accesorio. Respeta el
floor glibc y los contratos SSH, Windows y folder workspaces de AGENTS.md.
Tests y apps siempre ORCA_BACKGROUND_LAUNCH=1; usa aislamiento existente y Xvfb
propio >=100 si procede, nunca el display :99 de produccion ni focus/show.
No uses credenciales globales ni ejecutes smoke LLM, Docker pull, apt o sudo.
Si un gate no se puede ejecutar con seguridad, reporta bloqueo, no un verde.
Corrige fallos propios con cambios minimos, maximo 2-3 rondas razonadas. Nunca
omitas hooks ni desactives reglas de lint. No repitas un build/pack ya terminado.

6. Commit solo de tus cambios revisados, con hooks normales. Antes del push,
vuelve a consultar origin/main-kukapu mediante fetch acotado y comprueba que su
OID sigue siendo el validado, que main-kukapu local no tiene trabajo inedito y
que tu arbol esta limpio. Si otro actor avanzo el remoto o la rama local, para:
no publiques sobre una base nueva sin revalidar ni descartes cambios de nadie.
Solo si todos los gates pasan: git push origin HEAD:main-kukapu, sin force.
Comprueba el SHA remoto con git ls-remote y registra el resultado. No hay paso PR.

7. NO hagas checkout, pull, merge, stage, stash, snapshot, reset ni limpieza en
el checkout principal ni en otros worktrees, aunque parezcan limpios. Pueden
tener agentes, procesos o trabajo concurrente. Deja indicado el fast-forward
pendiente para que el usuario/coordinador lo haga en una ventana segura.
No elimines worktrees, ramas ni terminales. No instales ni reinicies servicios.

8. Si hay bloqueo, no pushees. Conserva el trabajo propio y su evidencia en tu
rama; anota el motivo con orca worktree set --worktree active --comment.
Resumen: OIDs antes/despues, commits oficiales incorporados, decisiones de
conflicto, cambios propios preservados, gates y comandos/resultados exactos,
limites, push si/no y checkout principal pendiente. Nunca publiques secretos,
capabilities ni pairing. Ejecuta date '+%A, %Y-%m-%d' y cierra con
"Dia y fecha de ejecucion: <resultado>".
```

## Precheck

Solo consulta referencias; no integra commits, toca ficheros ni lanza el agente
si no hay novedades. Un error Git debe impedir el lanzamiento, no convertirse
en un resultado positivo por negar cualquier codigo de salida.

```bash
git -C /home/kukapu/dev/projects/orca fetch -q --no-tags origin refs/heads/main-kukapu:refs/remotes/origin/main-kukapu && git -C /home/kukapu/dev/projects/orca fetch -q --no-tags upstream refs/heads/main:refs/remotes/upstream/main && git -C /home/kukapu/dev/projects/orca merge-base --is-ancestor main-kukapu origin/main-kukapu && (git -C /home/kukapu/dev/projects/orca merge-base --is-ancestor upstream/main origin/main-kukapu; result=$?; test "$result" -eq 1)
```

Timeout: 60 segundos. La version del comando es especifica de este host Linux;
en SSH o Windows se debe usar el ejecutor y shell del host propietario.

## Aplicacion Y Limites

El runtime `.1` no guarda el campo model: una respuesta ok no demuestra que se
haya aplicado. `.2` incorpora el soporte por automatizacion (`63a3944846`). Tras
la instalacion EXTERNA del usuario, editar la definicion existente y leerla de
nuevo; exigir `agentId=opencode`, `model=openai/gpt-6-astra`, base remota y prompt
identico al bloque canonico. No activar otra automatizacion como workaround.

No se lanza una sincronizacion ni una llamada LLM para comprobar una edicion de
configuracion. La primera corrida programada debe aportar evidencia del modelo
efectivo y de sus gates. Catalogo disponible no equivale a cuota garantizada.

Esta decision sustituye las instrucciones antiguas de rescatar WIP ajeno,
omitir hooks, dar prioridad incondicional a upstream o actualizar automaticamente
el checkout principal. Los resultados historicos no autorizan repetir esas acciones.
