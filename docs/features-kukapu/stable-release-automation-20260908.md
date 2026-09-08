# Automatizacion Estable Y Candidato 1.4.198

## Decision Y Aplicacion

El usuario autoriza cambiar la automatizacion existente antes de preparar
`1.4.198-kukapu.1`: revisar diariamente releases estables oficiales, integrar su
tag exacto, verificar candidato/artefactos, publicar codigo en main-kukapu y
artefactos en draft del fork solo con gates completos. Instalacion separada.

Se edito la definicion `3eb73380-5393-4ded-bc72-340a137008f6` via
`orca automations edit`, sin ejecutar `automations run` ni lanzar otro agente.
Lectura posterior y aserciones confirmaron:

- Modelo `openai/gpt-6-astra`, OpenCode, effort null.
- Base `origin/main-kukapu`, nuevo worktree por run, sesion nueva.
- Mismo owner, source/run context y host.
- Mismo horario `FREQ=DAILY;BYHOUR=5;BYMINUTE=0`, timezone Europe/Madrid, dtstart,
  enabled y nextRunAt `1788930000000`.
- Prompt identico al bloque canonico de `docs/reference/upstream-sync-automation.md`.
- Precheck ESM embebido en la definicion, timeout 240 s; sin dependencia de este
  worktree, rutas del checkout principal o ficheros temporales.

El precheck reutiliza el selector semver y la metadata de worktrees de Orca:
no segundo servicio, ledger global, instalacion ni cambio de configuracion global.
Corrige el selector para excluir tambien prereleases y flags equivalentes de gh.
Las respuestas gh se reducen a tag/draft/prerelease. Limite de diez paginas por
repo; inventario incompleto/error bloquea. El primer limite de tres paginas se
rechazo en la prueba real: upstream ya tiene mas de 300 releases contando RC.

La definicion inicial incorpora `baselineTag=v1.4.197` como umbral historico de
version entregada, no como certificado de procedencia del antiguo build.
Preparaciones persistentes y releases del fork elevan ese umbral. No comparar
solo package.json ni inferir instalacion de una build terminada.

## Prueba Real Sin Lanzamiento

El comando embebido se probo primero antes de aplicar la definicion:

```json
{"exitCode":1,"result":{"launch":false,"reason":"reconcile-legacy","upstreamTag":"v1.4.198"}}
```

Tras aplicar, registrar la preparacion bloqueada de 198 y releer su comentario,
se ejecuto el comando exacto almacenado en la definicion:

```json
{"storedPrecheckExit":1,"outcome":{"launch":false,"reason":"preparation-pending","upstreamTag":"v1.4.198"}}
```

Esto es el resultado esperado: no duplicar la preparacion de 198 ni la de otra
release mientras este bloqueo este sin reconciliar. No es un fallo de tests ni
un verde de release. El horario permanece habilitado; el precheck evita crear
otro worktree/agente. La evidencia anterior se conserva debajo del marker.

## Procedencia Del Tag

`gh release view v1.4.198 --repo stablyai/orca` confirmo release publicada,
no prerelease, publicada `2026-09-08T08:41:17Z`.

| Referencia | OID |
| --- | --- |
| Tag anotado oficial | `36b992b862c1c43eddab6cb5fa7bb2f69cc1f697` |
| Commit peeled v1.4.198 | `e0826956fcfc532f5a1e55b5e081f2e57e553c43` |
| Fork publicado y main-kukapu local | `da3def1b0f107f5294860282ddcb39d3bd024741` |
| Base upstream ya integrada en el fork publicado | `314506003a16297006225147fef8bdcec2186da8` |
| Checkpoint local previo | `9a2a3a26baf58d838b7291801846d93d38cf5a50` |
| Upstream del checkpoint | `d3baad25272242410688e6fe86f1aa57c71f71e9` |
| Merge-base tag/base upstream publicada | `3be526c5e68f6666e88983df63b16d07bb1d0817` |

Comandos de referencia, ejecutados desde este worktree:

```bash
git ls-remote upstream refs/tags/v1.4.198 'refs/tags/v1.4.198^{}'
git fetch --no-tags upstream refs/tags/v1.4.198:refs/tags/v1.4.198
git fetch --no-tags origin refs/heads/main-kukapu:refs/remotes/origin/main-kukapu
git merge-base --is-ancestor main-kukapu origin/main-kukapu
git merge-base --is-ancestor 314506003a16297006225147fef8bdcec2186da8 v1.4.198
git merge-base --is-ancestor d3baad25272242410688e6fe86f1aa57c71f71e9 v1.4.198
git merge-base --is-ancestor v1.4.198 d3baad25272242410688e6fe86f1aa57c71f71e9
git rev-list --count v1.4.198..314506003a16297006225147fef8bdcec2186da8
git rev-list --count --right-only --cherry-pick v1.4.198...314506003a16297006225147fef8bdcec2186da8
git rev-list --count v1.4.198..d3baad25272242410688e6fe86f1aa57c71f71e9
git diff --shortstat v1.4.198 314506003a16297006225147fef8bdcec2186da8
```

Fetch exit 0; main-kukapu local incluido en origin (exit 0). Las tres comprobaciones
de ancestro con el tag devolvieron exit 1, no errores. Recuentos: **91**, **90** y
**160** respectivamente. El primero mide commits no alcanzables desde el tag;
el segundo descuenta equivalencia de parches segun Git, no prueba equivalencia
funcional completa. Delta tag/base upstream: 1460 archivos, +84672/-19326 lineas.

**BLOQUEO DE PROCEDENCIA:** 198 es un corte estable divergente con arreglos de
release propios, no simplemente la punta main posterior al checkpoint. Incluso
origin/main-kukapu ya contiene upstream fuera de ese corte. Un merge del tag no
lo quita. No se ha certificado ni empaquetado el checkpoint como 198-kukapu.1.

Reconstruir una base estable exige separar modificaciones del fork y cambios
upstream excluidos, revisar dependencias entre ellos y definir la transicion de
main-kukapu sin force ni perdida de trabajo. Eso requiere reconciliacion
supervisada; no un reset, un revert masivo ni renombrar la version. El checkpoint
previo permanece intacto en la historia. No se instalo ni reinicio produccion.

## Verificacion De La Automatizacion

Con Node 24.11.1 y wrapper `.tmp/sync/run-clean.sh`: entorno aislado, CI=1 y
ORCA_BACKGROUND_LAUNCH=1, sin display ni cuentas LLM. Sin instalar dependencias
adicionales ni repetir empaquetados anteriores.

```bash
pnpm tc
pnpm test config/scripts/upstream-release-precheck.test.mjs config/scripts/latest-stable-release.test.mjs src/main/automations/service-precheck.test.ts src/main/automations/precheck-runner.test.ts src/cli/handlers/automation-owner-fencing.test.ts src/main/automations/automation-update-host-retarget.test.ts --maxWorkers=2
pnpm run check:code-quality:changed 9a2a3a26baf58d838b7291801846d93d38cf5a50
```

Typecheck exit 0; tests **99/99**, seis suites, sin skips. Calidad exit 0,
cuatro archivos de codigo y cero findings nuevos. Logs locales
`.tmp/sync/stable-tc.log`, `stable-tests.log` y `stable-quality.log`.
El commit se realiza con hooks normales; evidencia en `stable-commit.log`.
Revisor independiente detecto transiciones de exito no explicitas y errores sin
sanear del configurador temporal; ambos corregidos antes de aplicar.

Configurador temporal y comprobacion almacenada quedan en `.tmp/sync/`; el futuro
precheck no los necesita. No se copian credenciales ni se accede a otro checkout.
`cloud/node-compile-cache/` sigue sin trackear, excluido del commit, sin limpiar.

No push de main-kukapu, tag del fork, draft, nueva build ni instalacion. El cambio
de politica SI esta aplicado al runtime aunque su codigo/documentacion se
conserven localmente hasta reconciliar la base. Checkout principal no adelantado;
eventual fast-forward queda al coordinador tras publicacion validada.

Dia y fecha de ejecucion: martes, 2026-09-08
