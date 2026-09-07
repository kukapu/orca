# Validacion remota aislada 1.4.197-kukapu.2 (bloque 4)

- Fecha: 2026-09-06. Run `run_3bc1b0c65acb`, task `task_09f1d70c11f2` (bloque 4);
  harness heredado de `task_b0cb37cb6476` (4a) y corregido/ejecutado aqui.
- Skill `$electron`: no cargado. Flujo: Playwright CDP + helpers del repo, siempre
  `ORCA_BACKGROUND_LAUNCH=1`, host headless `--serve`, xvfb propio (nunca :99).
  No computer-use ni `show()`.
- Revision bajo prueba: `ee2e5da315` + cambios sin commit de bloques 1-3;
  build de validacion propio (ver Comandos), NO es el bundle de produccion.
- Coordinador = RuntimeClient host-local; todas las mutaciones por ahi o por el CLI
  del worker dentro de su PTY. Los clientes emparejados son **read-only** (guard
  `assertObserverReadOnlyMethod`, param-aware para `orchestration.check`).

## Resultado ejecutado

| Cobertura                                                                   | Resultado                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unit harness (`remote-validation-isolated-host.unit.test.ts`)               | 18/18 verde                                                                                |
| Unit credenciales (`real-agent-credentials.unit.test.ts`)                   | 3/3 verde                                                                                  |
| E2E `multi-client-orchestration-lifecycle.spec.ts`                          | **1/1 verde (16s)** contra build de validacion 12:02; ver Validez                          |
| Regresion residual OBS (`worker-observed-options-session-boundary.test.ts`) | 3/3 verde (pina el evidence-clock gate de 3b; el residual A→B→A tardio vive en OBS3c)      |
| Suite observadas existente (`worker-observed-options.test.ts`)              | 8/8 verde                                                                                  |
| Real OpenCode/Pi smoke                                                      | NO ejecutado (gate no aprobado; spec corregida segun blockers, pendiente credenciales+LLM) |
| Complemento web multicliente                                                | Build web preparado (exit 0); E2E NO ejecutado (gate tras OBS3c)                           |

## Validez del verde E2E (no reclamar de mas)

- El verde E2E corre contra el build de validacion 12:02 (`ee2e5da315` + bloques
  1-3 a esa hora). Caracteriza ese build; NO aplica al src posterior.
- El runner detecto correctamente 4 archivos runtime mas nuevos que el build
  (`server-state.ts`, `server-tab-cleanup.ts`, `server-status-application.ts`,
  `server-status-update.ts` — ediciones OBS3c en curso) y REHUSO ejecutar
  (`exit 2`, sin `ALLOW_STALE`). Decision correcta, no un fallo del harness.
- Rerun final simulado + web: pendiente de cierre OBS3c y nuevo gate de rebuild
  (incluira la fase 6 de no-resurreccion endurecida y el Phase-6 tercer worker,
  aun sin ejecutar).
- El guard de staleness ignora `*.test.ts`/`*.spec.ts`/`__fixtures__`/bench: el
  bundle nunca los incluye.

## Fases del E2E ejecutado (`rpc-two-paired-clients`)

1. Dos clientes RPC persistentes con identidades distintas (rotate de pairing
   offer), A via `orchestration.runCurrent`, B via `orchestration.taskList` por
   run id (superficie antigua).
2. Continuidad con clientes fuera: worker opencode fake ACK; AMBOS clientes se
   desconectan DURANTE trabajo activo; veredicto `live` por workerShow y
   completacion (worker_done real via CLI con capability) sin clientes;
   reconexion con identidad original; dispatch completed + runCurrent estables.
3. ask/reply/ACK real: `orchestration ask` bloqueante del worker via CLI con
   `--dispatch-capability`; pregunta visible al coordinador y a cliente A
   (check peek); reply; `ASK_ANSWER_RECEIVED:yes` en terminal y ledger (status 0).
4. Salida estructurada: `workerRead` desde A y B con mismo `sourceIdentity`/`source`
   y fallback explicito (`terminal`, fake sin sesion de proveedor).
5. Modelo observado: el fake reporta `fake/glm-5.3-hook-evidence` por el endpoint
   REAL de hooks (`/hook/opencode|pi`, token, paneKey, launchToken);
   `workerShow.observation.observedOptions` = observed con model+thinkingLevel (pi)
   — evidencia de hook, nunca eco del launch.
6. Stop de worker ACTIVO (state `stopped`, terminal fuera de list), release de
   worker completado (`released`), `workerRead` archivado (`archived: true`) con
   contenido, y fase de no-resurreccion endurecida: inventario base (solo
   coordinador), reconnect de AMBOS clientes, tercer worker con handle nuevo
   (nunca blacklist de 2 handles — el incidente real reaparece con handles
   nuevos), inventario == base + [tercer worker], dispatch ids distintos,
   vuelta al inventario base tras liberar el tercero.
   (Fase 6 endurecida escrita y typeclean; su ejecucion queda para el rerun
   final tras OBS3c por el guard de staleness.)

## Hallazgos durante la validacion

1. **Profile patch entre procesos no llega al store del serve.** Patchear
   `orca-data.json` en `restartServeProcess.betweenProcesses` deja el archivo con
   los overrides pero `settings.get` devuelve vacio (timing de carga del store).
   Ademas `settings.update` (RPC) NO acepte `agentCmdOverrides`. Solucion usada:
   opcion aditiva `settingsOverrides` en `launchHeadlessPairedRuntimeHost` ANTES
   del primer arranque (unica ventana fiable). Se elimino el helper de file-patch.
2. **Sin hooks no hay evidencia de entrega en serve headless.** Un agente sin
   eventos de hook nunca pasa la verificacion `agent_prompt_stalled`: no hay
   renderer que alimente `workingSequence` y la evidencia de bytes exige estar
   `working` en el baseline. El fake agent ahora POSTea al endpoint real de hooks
   (como los plugins reales); eso ademas ejercita el pipeline OBS de bloque 3.
3. **Residual OBS: mi test pina el evidence-clock gate de 3b; el residual A→B→A
   tardio (todo dentro del MISMO Dispatch) vive en OBS3c
   (`task_579692d78147`) y queda fuera de mi scope.** La coordinacion aclara que
   el evidence-clock gate solo excluye evidencia anterior al Dispatch. Mi test
   `worker-observed-options-session-boundary.test.ts` cubre late-delivery de
   sesion anterior + fence por launchToken + evidencia genuina (3/3 verde,
   test-only, src intacto). No afirmo solucionado el residual: sigue abierto en 3c.
4. **E2E tsc baseline**: 193 errores preexistentes en archivos ajenos;
   0 en archivos de este bloque.
5. **Ledger endurecido (coordinador)**: el lector tolera SOLO un fragmento final
   sin delimitador y falla ante cualquier linea completa malformada
   (`readFakeAgentLedger`/`expectCleanFakeAgentLedger` + regresion unitaria).
   Ademas: test de EJECUCION del script generado (spawn real del cjs, paste
   bracketed con `\r`, CLI stub) que prueba bytes newline reales en el ledger —
   clase de bug del doble-escape que si ocurrio y se corrigio aqui.
6. **Smoke real: blockers de revision corregidos en la spec (sin gastar LLM ni
   crear credenciales)**: sin wrapper con valores interpolados — las credenciales
   viajan por `agentDefaultEnv` (mecanismo existente del runtime) validadas por
   allowlist (`readRealAgentEnvFile`: rechaza HOME/PATH/ORCA__/XDG__/LD_*/config
   dirs; acepta `$`, espacios y backticks sin shell de por medio; 3 unit tests);
   `runProcess` en vez de spawnSync directo; workerRead exige `source:
'transcript'` + mensaje **assistant** con el marker (eco del prompt de usuario
   nunca pasa); ambos observadores vivos con reconnect a mitad del run.

## Aislamiento verificado

- userData/home/port mkdtemp o efimeros; guard activo contra 6768 y `~/.config/orca`.
- `DISPLAY=:99` rechazado en spec y runner (este worker corre bajo :99 y el guard salto).
- Fake agents con marker propio y overrides; los binarios reales jamas se lanzaron
  en el E2E simulado (un early run con overrides no aplicados lanzo OpenCode real
  por PATH; se detecto y corrigio — hallazgo 1).
- Runner rechaza `out/` obsoleto (mtime src vs build) e imprime revision/fecha.
- Credenciales reales: nunca copiadas ni creadas; el smoke real usara
  `ORCA_E2E_REAL_AGENT_ENV_JSON` via `agentDefaultEnv` (JSON a JSON, nunca
  scripts ni logs).

## Archivos propios (bloque 4)

- `tests/e2e/helpers/remote-validation-isolated-host.ts` — read-only guard
  param-aware, `status.get` fijado contra `STATUS_METHODS`, `seedHostFolderWorkspace`,
  ask marker, unwrap helper.
- `tests/e2e/helpers/remote-validation-isolation-guards.ts` — aislamiento
  (userData/puerto/DISPLAY de produccion).
- `tests/e2e/helpers/fake-agent-ledger.ts` — lector newline-JSON estricto
  (tolera solo fragmento final; falla ante linea completa corrupta).
- `tests/e2e/helpers/remote-validation-isolated-host.unit.test.ts` — 18 tests
  (incl. ejecucion del script generado con paste real y ledger byte-exacto).
- `tests/e2e/helpers/fake-opencode-pi-orchestration-agents.ts` — ask via CLI,
  hooks reales, ledger unico, eventos por kind.
- `tests/e2e/multi-client-orchestration-lifecycle.spec.ts` — 6 fases.
- `tests/e2e/multi-client-orchestration-real-agents.opt-in.spec.ts` — smoke real
  opt-in (launch/modelo observado/worker_done propio/workerRead/release), doble
  gate binario+LLM, allowlist GLM 5.3 / Grok 4.6 (Grok-OpenCode siempre
  `xai/grok-4.6`), credenciales via env JSON.
- `tests/e2e/helpers/real-agent-credentials.ts` (+ `.unit.test.ts`) — allowlist
  de env para el smoke real via `agentDefaultEnv` (sin shell, sin scripts).
- `config/scripts/run-multi-client-orchestration-e2e.mjs` — guards (DISPLAY,
  staleness excluyendo test-files; imprime revision).
- `src/main/runtime/orchestration/worker-observed-options-session-boundary.test.ts`
  — regresion residual OBS (test-only, aprobada por coordinador).
- `tests/e2e/helpers/headless-paired-runtime-host.ts` — opcion aditiva
  `settingsOverrides` (compartido; sin cambios de comportamiento para otros specs).
- este documento.

## Comandos ejecutados (directos, sin pnpm)

```bash
# Build de validacion (aprobado por ask):
ORCA_BACKGROUND_LAUNCH=1 NODE_OPTIONS=--max-old-space-size=8192 \
  node node_modules/typescript/bin/tsc -p config/tsconfig.cli.json --outDir out --composite false --incremental false
ORCA_BACKGROUND_LAUNCH=1 VITE_EXPOSE_STORE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node config/scripts/run-electron-vite-build.mjs --mode e2e
# E2E aislado (solo con build al dia; el guard rehusara si src cambio):
xvfb-run --auto-servernum env ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1 TMPDIR=/tmp/opencode \
  node config/scripts/run-multi-client-orchestration-e2e.mjs    # 1 passed (16s) contra build 12:02
# Build web preparado (aprobado A):
ORCA_BACKGROUND_LAUNCH=1 NODE_OPTIONS=--max-old-space-size=8192 \
  node config/scripts/run-vite-web-build.mjs                    # exit 0
ORCA_BACKGROUND_LAUNCH=1 node config/scripts/verify-web-build.mjs  # exit 0
# Tests directos (reintento QA4, comandos directos sin pnpm):
ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run \
  --config config/vitest.config.ts --maxWorkers=2 \
  tests/e2e/helpers/remote-validation-isolated-host.unit.test.ts \
  tests/e2e/helpers/real-agent-credentials.unit.test.ts   # 21 passed (2 suites)
# (La regresion OBS y la suite observed-options se verificaron en el dispatch
# anterior: 3/3 y 8/8; el test session-boundary NO se toca por orden expresa.)
# Typecheck e2e general: 188 errores preexistentes ajenos (era 193; se
# corrigieron 5 de strictness en headless-paired-runtime-host, helper propio,
# sin cambio de comportamiento). 0 en archivos del bloque. No se finge verde.
# Lint/formato: oxlint 0 findings; oxfmt aplicado, solo archivos propios.
# Build web preparado en dispatch anterior (exit 0 ambos) — E2E web NO ejecutado.
```

## Continuacion QA4 (task_8a7d9e85e353): 6 exigencias + 2 correcciones de revision

Sin src/main, sin docs/uso/AGENTS/.gitignore, sin build/E2E/LLM/claves/pnpm.
`apply_patch` no existe en este entorno (verificado `command -v`/type); ediciones
como reemplazos exactos old→new revisables, sin refactor amplio.

Sin src/main, sin docs/uso/AGENTS/.gitignore, sin build/E2E/LLM/claves/pnpm.
`apply_patch` no existe en este entorno (verificado `command -v`/type); ediciones
como reemplazos exactos old→new revisables, sin refactor amplio.

1. **Allowlist positiva de credenciales.** `real-agent-credentials.ts` ahora solo
   acepta `ZAI_API_KEY`, `ZHIPU_API_KEY`, `XAI_API_KEY` (ampliar solo con
   necesidad aprobada); `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG`,
   `PI_CODING_AGENT_DIR` y cualquier otra clave quedan fuera por defecto.
   JSON invalido → error generico sin contenido; valores literales intactos.
   Tests negativos incluidos.
2. **Igualdad de env sin filtrar secretos.** `diffRealAgentEnvKeys` /
   `assertRealAgentEnvApplied`: comparan por NOMBRE de clave; el mensaje de
   fallo solo lista keys (missing/extra/mismatched), jamas valores. La spec ya
   no usa `toEqual` sobre el mapa. Limpieza: userData aislado dentro del
   scratch, `rmSync` en `finally`; `settings.get` solo vive en memoria del test.
3. **Modelo observado exacto por agente.** `observed-model-match.ts`:
   igualdad exacta tras trim (OpenCode reporta el id configurado verbatim;
   Pi lee ctx.model por evento). Un segmento final coincidente con proveedor
   distinto, case distinto o sufijos YA NO pasan (tests). Si un proveedor
   canoniza ids, el smoke falla honesto y se revisa la regla con evidencia.
4. **Reconnect DURANTE task activa en el smoke real.** La spec ordena al worker
   abrir con un ask acotado de readiness ("ready to proceed with smoke?",
   opciones yes, 60s); el coordinador espera la pregunta, CIERRA el cliente A,
   responde, reconecta y verifica — outage mid-task por construccion, sin
   sleeps. La espera de modelo observado y la completacion siguen despues.
5. **Runner endurecido.** Sin bypass `ALLOW_STALE`; frescura exigida de
   out/main Y out/cli; TMPDIR por plataforma (`os.tmpdir()` en win32);
   detector de fixtures con ambos separadores; git y playwright por
   execFileSync/spawnSync con argv fijo (patron existente de config/scripts,
   sin shell ni entradas reflejadas).
6. **Fases + oracle inventory/tercer worker conservados; caso cierre
   registrado cubierto deterministicamente.** Fase 6b: stop tras release
   exige receipt already-settled (`alreadySettled: true`,
   `processAction: 'none'`) e inventario intacto. La rama ptyKilled:false
   sigue cubierta por unit existente
   (`orchestration-worker-stop-liveness-verdict`: "does not settle a bare
   false close as stopped"); el fake agent nunca muere solo, asi que esa rama
   no tiene fixture E2E honesto — limite documentado, no fingido.

Verificado en este dispatch (node directo, ORCA_BACKGROUND_LAUNCH=1,
TMPDIR=/tmp/opencode, maxWorkers 2): 26 unit tests verdes (3 suites),
oxlint/oxfmt limpios, `tsc node` exit 0, `tsc e2e` 188 preexistentes ajenos y
0 en archivos del bloque.

Revision posterior (gate sigue cerrado hasta OBS3d): (a) el poll de modelo del
smoke real usaba `connected.clientA` ya cerrado — ahora TODO acceso de A pasa
por `reconnectedA` (runCurrent + workerShow); (b) el runner ya no importa
child_process directo: importa dinamicamente el wrapper COMPILADO
`out/shared/child-process/run-process.js` (verificado importable, expone
runProcessSync/runProcess/spawnProcess; git via wrapper devuelve revision con
code 0) DESPUES del guard de frescura, lo usa para git y playwright; eliminado
`depth>8` y los errores de lectura de source fallan closed con diagnostico;
formato reaplicado (incl. linea 83 del unit de credenciales). Re-verificado:
26 units verdes, lint/format limpios, tsc e2e 188 ajenos / 0 propios.

Ordenes del coordinador: corregir el error sintactico conocido (import
duplicado en lifecycle.spec.ts:41 — YA CORREGIDO y verificado), revisar todos
los cambios parciales (wrapper credenciales, oraculos no-reaparicion,
transcript assistant), no editar src/main ni el test session-boundary.

- Sintaxis: header de imports reescrito limpio; oxlint/tsc confirman.
- Lifecycle: endurecida la rama de diagnostico ante dispatch null y `lateA`
  ahora lee runCurrent (antes conexion sin lectura).
- Real-agents: sin restos del wrapper; credenciales solo por `agentDefaultEnv`
  - allowlist; `runProcess`; transcript exige mensaje assistant.
- Helper compartido: 5 errores preexistentes de strictness corregidos sin
  cambio de comportamiento (API intacta para los demas specs).
- Autorizado en este reintento: solo units del harness + build web ya preparado.
  Sin rebuild main, sin E2E final, sin LLM, sin claves, sin pnpm/prod.

## Gate DEV (task_8a7d9e85e353): build + E2E de caracterizacion

Fuentes OBS3e congeladas durante el run. Comandos directos aprobados, sin pipes:

- CLI: `tsc -p config/tsconfig.cli.json --outDir out` → exit 0 (out/cli 14:07:04).
- Electron: `electron-vite build --mode e2e` (+VITE_EXPOSE_STORE) → exit 0
  (out/main 14:07:18; warnings preexistentes de CSS/chunks).
- **E2E simulado: 1 passed (16.8s)** — incluye fase 6 endurecida
  (inventario base, reconnect de ambos clientes, tercer worker con handle
  nuevo, vuelta a inventario base, 6b stop-tras-release already-settled).
- Web: rebuild con `VITE_EXPOSE_STORE=true` (el primer intento sin el flag
  dejaba `window.__store` ausente en el cliente web; flag verificado en
  `src/renderer/src/store/index.ts` + `web-e2e-config.ts`), verify exit 0.
- **Complemento web: 4 failed → 4/4 VERDE tras diagnostico + fixes de harness**
  (ver seccion diagnostico). Causas identificadas con corrida instrumentada
  aprobada por el coordinador; caracteriza el bundle OBS3e congelado (out/ 14:07).

### Web 4x rojo: diagnostico post-compact (artefactos + fuente, solo lectura)

Correccion sobre el resumen previo: los `error-context.md` de las 4 pruebas
muestran que el cliente emparejado SI renderiza las worktrees del spec
(opciones `e2e-client-a/b-*` visibles en su listbox "Worktrees"). Los fallos
son dos causas distintas, ninguna es regression de paired-web ni del build:

- **Pruebas 3-4 (labels ingles): CAUSA CONFIRMADA = locale.** La UI resuelve
  idioma `system` -> `navigator.language` (`I18nProvider`); esta maquina es
  es-ES, asi que el cliente renderiza "Nueva pestaña"/"Agregar proyecto" y el
  spec busca `getByRole('button', {name: 'New tab'})` y
  `{name: 'Add Project'}`. CI corre runners en-US (`.github/workflows/e2e.yml`
  pasa `ORCA_E2E_WEB_CLIENT=1` en shards en-US), por eso alla es verde. El
  harness NO fija idioma en ningun sitio (`e2e-completed-onboarding-profile.ts`,
  `orca-app.ts`, launch args: sin `language`/`locale`). Fix de harness: fijar
  `settings.language='en'` en el perfil e2e (host) y verificar que el cliente
  web lo hereda via settings-sync.
- **Pruebas 1-2 (XPath `data-worktree-id`): causa acotada, no cerrada.** El
  locator busca el id del store del HOST (`${repoId}::${path}`,
  `shared/worktree/types.ts:62`) en el DOM del cliente; las filas existen pero
  el atributo no coincide. Revision estatica de toda la cadena cliente
  (`web-worktrees-api.ts` -> `web-runtime-worktree-catalog.ts` ->
  `fetch-worktrees.ts` -> `fetched-worktree-merge.ts` -> `item-row.tsx:157`):
  NINGUN hop reescribe ids; el runtime embebido comparte el store del main
  (`main-process-runtime-service.ts` usa `state.store`). Hipotesis restantes:
  (a) el catalogo del cliente llega bajo otro repo-uuid (registro
  duplicado/orden distinto de `repos[0]` host vs cliente), (b) las filas
  visibles son filas fallback del grafo publicado (sin el atributo) — aunque
  aparecen worktrees sin sesiones, lo que la debilita. Discriminar exige UNA
  corrida instrumentada (dump de `page.url()`, valores
  `[data-worktree-id]` del cliente, `repos[].id` del cliente): pedir scope.

#18878 (ayer) solo cambio el opener del dialogo Add Project; no introdujo los
locators que fallan. No especulo causa por fecha: las 4 pruebas comparten
dependencia de locale/entorno local.

### Web 4x rojo: cierre con corrida diagnostica aprobada (bundle OBS3e 14:07)

El coordinador aprobo una corrida diagnostica unica (instrumentacion temporal
del test, retirada despues) + fix de fixture `language=en`. Evidencia:

- **Pruebas 1-2, causa real: catalogo runtime eventualmente consistente.** La
  replica exacta del test 1 reprodujo el fallo: el host (via poll que refresca
  el path IPC) ve las 4 worktrees; el cliente recien emparejado sirve su primer
  snapshot `worktree.detectedList` sin las ramas nuevas (solo main repo +
  e2e-secondary), mismo repo-uuid en ambos lados (descarta mismatch de ids; la
  primera corrida diagnostica mostro el caso inverso: cliente fresco, host
  stale). Es carrera de scan-cache (TTL ~30s) entre los paths IPC-desktop y
  RPC-runtime; en esta maquina el lag excede el timeout plano de 30s del spec.
  Fix (spec): `openPairedClient` ahora usa `expect.poll` con presupuesto de 90s
  para la fila del cliente.
- **Pruebas 3-4, causa locale confirmada + por que el pin de perfil no basta:**
  `uiLanguage` NO es runtime-backed (`web-preferences-store.ts` solo refleja
  una allowlist), es preferencia por-dispositivo; cliente con particion fresca
  resuelve `system` → es-ES local. Fixes: (a) perfil e2e aislado fija
  `uiLanguage: 'en'` (host; `e2e-completed-onboarding-profile.ts`), (b)
  `openPairedClient` fija `uiLanguage:'en'` en el store del cliente tras abrir
  (precedente en repo: otros specs ya hacen `updateSettings({uiLanguage:'en'})`).
  Overrides explicitos de specs de idioma siguen respetados (solo es default).
- **Verificacion sobre el MISMO build congelado (out/ 14:07, revision
  ee2e5da315 + bloques anteriores; sin rebuild):**
  `xvfb-run --auto-servernum env ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1
ORCA_E2E_WEB_CLIENT=1 TMPDIR=/tmp/opencode node_modules/.bin/playwright test
tests/e2e/multi-client-navigation-isolation.spec.ts --config
tests/playwright.config.ts --project electron-headless --workers=1`
  → **4 passed (1.6m)**.
- Higiene: spec diagnostico temporal eliminada; `oxlint` 0 y `oxfmt` 0 en los
  2 archivos tocados; `tsc` e2e sin errores en archivos propios (188
  preexistentes ajenos se mantienen).
- NO reclamar release ni verde de src actual: el otro agente edita src/main
  (autoridad de host); este verde caracteriza el bundle congelado + harness.

## Preflight smoke real (aprobado: solo metadatos, sin LLM/secrets/credenciales)

Binarios resueltos y ejecutados bajo HOME/XDG aislados (`/tmp/opencode/
preflight-home`; configs reales del usuario NO leidas):

- **OpenCode 1.18.29** (`~/.opencode/bin/opencode`), catalogo models.dev
  refrescado en XDG aislado (`--refresh`, cache publica leida):
  - `zai-coding-plan/glm-5.3` EXISTE: env `ZHIPU_API_KEY`,
    api `https://api.z.ai/api/coding/paas/v4`, coste 0/0 (cuota Coding Plan).
  - NO confundir con `zai/glm-5.3` (api `https://api.z.ai/api/paas/v4`,
    pago por token, coste>0): el smoke debe usar `zai-coding-plan/glm-5.3`.
- **Pi 0.85.0** (mise node 26), docs/estaticos del paquete instalado
  (`providers.md`, `model-config`/bundle):
  - proveedor `zai` = "ZAI Coding Plan (Global)": env `ZAI_API_KEY`,
    baseUrl `https://api.z.ai/api/coding/paas/v4` — TODOS sus modelos
    (incluido `glm-5.3`) apuntan al endpoint Coding Plan; Pi NO tiene
    proveedor zai de API general ⇒ `zai/glm-5.3` ya usa la cuota correcta.
  - Cuidado con colision: `glm-5.3` tambien existe bajo `opencode-go`
    (endpoint OpenCode Zen, env `OPENCODE_API_KEY`); el smoke debe fijar el
    prefijo de proveedor (`--model zai/glm-5.3`), nunca solo el patron.
  - Alternativa China (`zai-coding-cn` + `ZAI_CODING_CN_API_KEY`,
    bigmodel.cn) no aplica a esta cuota.
- **Conclusion de inyeccion: NINGUNA necesaria.** Ambos CLIs traen el
  endpoint Coding Plan en su catalogo instalado; solo difieren los NOMBRES de
  env (`ZHIPU_API_KEY` para OpenCode, `ZAI_API_KEY` para Pi — ambos ya en la
  allowlist de `real-agent-credentials.ts`). El secret se mapea a ambos
  nombres segun el agente, sin credenciales en argv/scripts/assertions.
- No se implemento visor de cuotas ni features nuevas (fuera de scope).

## Ajustes post-preflight (msg_b0ee531f8904 + msg_2941b5fb068f)

- **TMPDIR portable** (`config/scripts/run-multi-client-orchestration-e2e.mjs`):
  fallback ahora `process.env.TMPDIR ?? os.tmpdir()` en todas las plataformas
  (antes `/tmp/opencode` hardcodeado en POSIX). Verificado con `node --check`,
  oxlint 0, oxfmt 0; SIN ejecutar E2E. Invocaciones del coordinador que ya
  pasan `TMPDIR=/tmp/opencode` no cambian.
- **Precondicion de identidad CLI pre-LLM** (nuevo, preparado, NO ejecutado;
  revisado por coordinador en msg_b7254604b28c y corregido):
  `tests/e2e/helpers/agent-cli-runtime-identity.ts` —
  `assertAgentCliBoundToTestRuntime` escribe un probe .mjs en scratch privado
  (0600), lo ejecuta DENTRO del PTY del host con un unico comando portable
  `node "<script>"` (sin encadenar `;`/`&&`, sin parsear salida del terminal:
  el eco no puede falsificar el nonce que vive solo dentro del script). El
  probe ejecuta `orca status --json` via el wrapper existente
  `runProcess` (`out/shared/child-process/run-process.js`) y escribe SOLO
  campos whitelisted + nonce a un archivo de resultado privado. El helper
  exige el contrato EXPLICITO `ok:true`, `runtime.state==='ready'`,
  `reachable===true`, `runtimeId === _meta.runtimeId` y comparacion EXACTA
  contra el `status.get` del host (sin busqueda recursiva/arbitraria); aborta
  por razon nombrada ante eco/parse/mismatch/spawn/timeout, con cleanup de
  terminal y scratch. Unit tests 10/10 cubren flujo completo (archivo tardio,
  nonce forgado ignorado, spawn-error, timeout, mismatch, host sin runtimeId,
  portabilidad del comando) — no solo parser. Cableado en el smoke antes de
  taskCreate/workerStart. Ejecucion diferida al proximo gate.
- Oxlint 0 / oxfmt 0 / tsc limpio en archivos propios; no se ejecutaron apps,
  builds ni LLM; no se leyeron credenciales.

## Gate integrado (msg_7aba7aeda9c9): builds 0, simulado 1/1, web 3/4, probe CLI 1/1

Fuentes core congeladas (OBS aceptado por coordinador: 8460 tests / 770 suites).
Builds directos sobre sources congelados:

- CLI: `node node_modules/typescript/bin/tsc -p config/tsconfig.cli.json
--outDir out --composite false --incremental false` → exit 0 (out/cli
  15:30:00).
- Electron: `ORCA_BACKGROUND_LAUNCH=1 VITE_EXPOSE_STORE=true
NODE_OPTIONS=--max-old-space-size=8192 node
config/scripts/run-electron-vite-build.mjs --mode e2e` → exit 0 (out/main
  15:30:10).
- Web: `ORCA_BACKGROUND_LAUNCH=1 VITE_EXPOSE_STORE=true node
config/scripts/run-vite-web-build.mjs` → exit 0; `verify-web-build.mjs` →
  exit 0.

Resultados:

- **Simulado (runner, build fresco): 1 passed (16.7s)** — runner reporta
  revision ee2e5da315, out/main 15:30:10, out/cli 15:30:00.
- **Web 4 tests: 3 passed (3.0m) + test 1 failed DETERMINISTA (3 corridas:
  full + 2 solo).** Evidencia exacta (dump temporal en timeout, spec lineas
  131-165, solo log en fallo): a los 90s el catalogo del cliente emparejado
  (DOM `data-worktree-id` + `worktreesByRepo`) contiene SOLO 2 worktrees
  (main + e2e-secondary), mismo repo-uuid que el host; el host ve las 4 (su
  poll paso). El MISMO flujo fue verde en 25s sobre build 14:07 (~1h antes,
  4/4). Tests 2-4 verdes en ambos builds, incluido otro test de pareja
  identico en forma. NO afirmo causa: viejo-verde/nuevo-rojo documentado;
  posible carrera latente/invalidacion/hydration en el primer pairing del
  catalogo detected del runtime embebido. Investigacion read-only asignada al
  agente core. Artifacts:
  `test-results/multi-client-navigation-is-86005-st-on-independent-worktrees-electron-headless/`
  (error-context.md, trace.zip, screenshots x3 corridas).
- **Probe CLI sin LLM (aprobado msg_f882f7c52134): 1 passed (1.8s)** sobre
  build 15:30 — `tests/e2e/agent-cli-runtime-identity.spec.ts`: dentro de un
  PTY del host aislado, `orca status --json` resolvio EXACTAMENTE el runtime
  de prueba (runtimeId exacto + contrato ready) via el helper probe
  (script node + runProcess, archivo resultado sanitizado + nonce). Sin
  credenciales, sin LLM. Comando:
  `xvfb-run --auto-servernum env ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1
TMPDIR=/tmp/opencode node_modules/.bin/playwright test
tests/e2e/agent-cli-runtime-identity.spec.ts --config
tests/playwright.config.ts --project electron-headless --workers=1`.
- **Ajustes msg_f882f7c52134 aplicados al helper y re-verificado**: (1)
  `evaluateAgentCliProbeResult` ahora exige `connectionState === 'connected'`
  (rechazo `runtime-connection-state:<valor>`, incluido null); (2)
  `buildAgentCliProbeCommand` usa `process.execPath` (sin depender de otro
  node en PATH) y reutiliza `buildShellCommandFromArgv`/`resolveStartupShell`
  - `resolveLocalWindowsAgentStartupShell` con pin de test
    `AGENT_CLI_PROBE_WINDOWS_SHELL = 'powershell.exe'` — quoting literal en
    sh/bash/zsh/fish, PowerShell y cmd para rutas con `$`, backticks, comillas
    y espacios. Unit: 12/12 verdes; probe e2e re-ejecutado VERDE 1.8s sobre
    build 15:30 (sin rebuild: 0 archivos src/config mas nuevos que out/main
    15:30:10). tsc e2e: mis archivos limpios (2 errores preexistentes en linea
    348 del spec de navegacion, fuera de mis cambios; proyecto e2e no es gate).

## Gate B: smoke real — fallo determinista pre-ask y diagnostico cerrado

- **Probe receipt+control (autorizado, SIN Enter/LLM) — CAUSA DISCRIMINADA**:
  `[GATE-B-BINDING]` foreground=opencode, hijos=true,
  foregroundProcessEvidence presente. `[GATE-B-PASTE-RECEIPT]`
  **accepted:true, bytesWritten:518, handleMatch:true, refusedReason:null**
  (el write-gate/driver NO rechazo). `[GATE-B-PASTE]` draftEvidenceFound=
  **false** (el paste bracketed multilinea ESC[200~...201~ no renderiza
  NADA) PERO controlSeen=**true** — la cadena corta ASCII sin brackets SI
  aparecio en el composer. Cadena causal del smoke: paste invisible -> CR
  sin contenido -> sin turno -> sin bytes -> delivery-evidence falla ->
  agent_prompt_stalled -> dispatch failed -> sin ask en 180s. Receipts
  tipados via extractTerminalSendReceipt (terminal.send devuelve
  accepted:false sin throw en rechazos — contrato real mapeado). Cero gasto
  LLM (Enter jamas enviado).
- **Probe chip+CR controlado (msg_5cf5b0cfaa40, UN turno LLM autorizado):
  1 passed (19.4s) — SUBMIT Y TURNO CONFIRMADOS**. Oraculo corregido al
  patron REAL: `[GATE-B-CHIP]` receipt accepted:true (517B) y **chipIndex=5**
  — artifact `02-after-paste.txt` muestra literal `[Pasted ~12 lines]` en el
  composer. `[GATE-B-ENTER-RECEIPT]` CR aceptado (1B). Post-CR: mensaje de
  usuario EXPANDIDO en la vista de sesion + indicador **`▣ Build · GLM-5.3`**
  - footer `esc interrupt` = **turno INICIADO (llamada LLM en curso)**.
    LIMITES: el veredicto 'assistant-reply-ready' del probe fue un FALSO
    POSITIVO (READY matcheo el ECO del mensaje de usuario — la trampa
    advertida); corregido con isTurnWorkingScreen (║/esc-interrupt; READY solo
    NO es veredicto; unit 13/13 con regression guard). Gasto: UN turno LLM
    (autorizado). Artifacts estables: `/tmp/opencode/orca-gate-b-chip-submit-
evidence/` (01-before-paste, 02-after-paste, 04-final; 0600/0700, sin
    secretos). CONSECUENCIA: la cadena paste→chip→CR→submit→turno funciona
    END-TO-END via terminal.send+createAgentSession; la diferencia con el
    smoke queda acotada a la RUTA workerStart (createTerminal(startupAgent)+
    authority fencing+writeTerminalAgentPrompt con
    serializeAgentPromptSubmission/generacion) — decision core.
- **Investigacion read-only del fuente real (msg_5228a3b56816) — MECANISMO
  EXACTO + RETRACTACION**: OpenCode 1.18.29 instalado = ELF Go con JS
  embebido (bunfs), handler localizado en offset ~106.58M del binario
  `/home/kukapu/.opencode/bin/opencode`. Cadena real:
  `onPaste` -> decodifica bytes, `preventDefault()`, `await Yf(texto)`;
  `Yf`: (1) sniffer `wa(p0(trimmed))` SOLO para extensiones imagen/svg/pdf
  (mapa .avf/.gif/.jpg/.pdf/.png/.svg/.webp) — texto plano retorna undefined
  y cae al umbral; (2) **umbral exacto: `lineas>=3 || trimmed.length>150`**
  con setting `paste_summary_enabled` (default TRUE salvo
  `experimental.disable_paste_summary`) -> `lf(texto, "[Pasted ~N lines]")`;
  (3) corto -> `editor.insertText` directo. `lf` NO descarta nada: inserta
  el chip `[Pasted ~N lines] ` en el editor y guarda el TEXTO COMPLETO en
  `prompt.parts` (type text, source.value=chip) — el submit (`kf`) resuelve
  los extmarks tipo prompt-part y envia `session.prompt({parts:[texto
completo...]})`. **RETRACTO "paste multilinea descartado
  silenciosamente"**: era un bug de DETECCION de mi probe — busque
  /pasted text/i y la etiqueta real es `[Pasted ~N lines]`; el conteo 11->11
  lineas es consistente con el chip reemplazando el placeholder en la MISMA
  fila del composer. Patrones de pantalla CORRECTOS para futuras pruebas
  autorizadas: `[Pasted ~N lines]`, `Failed to send prompt`,
  `Creating a session failed`. Existe toggle `app.toggle.paste_summary`
  (keybinding) y config `experimental.disable_paste_summary`.
- **Candidatos source-grounded para el fallo del smoke** (el paste SI llega
  como parts): (a) la cadena de submit `kf` tiene guards
  `$.creating()||yU.creating()`/`yU.pending()` — en HOME virgen sin sesion
  previa el primer submit pasa por el flujo `yU.getDirectory`/`progress()`
  (dialogo directorio/proyecto) que puede NO-OP silenciosamente el Enter ->
  sin bytes post-Enter -> `agent_prompt_stalled` + sin ask (CONSISTENTE con
  la evidencia); (b) fallo de `session.create`/`session.prompt` mostraria
  toast de error (bytes) -> INCONSISTENTE con stalled. Artifacts de tails:
  **BORRADOS** (dirs de test-results vaciados; solo .last-run.json) — la
  evidencia superviviente es el stdout sanitizado en los reportes.

- Corrida 1 (comando autorizado completo, 2 tests): OpenCode fallo en
  dispatchShow status='failed'; Pi no corrio (max-failures=1). Rerun launcher
  solo-OpenCode: mismo fallo 48.7s.
- Diagnostico whitelist (helper real-agent-dispatch-diagnostics.ts, 8/8
  unit): `[GATE-B-DIAG]` dispatchStatus=failed workerStage=**dispatch_input**
  setupState=not_applicable observationStatus=live epoch/worktree/terminal
  presentes capabilityRevoked=false observedOptionsPresent=true;
  `[GATE-B-RECEIPT]` receiptState=failed failedStage=dispatch_input
  **lastErrorToken=agent_prompt_stalled** refusalCode=NULL (write-gate NO
  involucrado; hipotesis Structured-Chat refutada).
- Semantica #16095 aplicada (stalled + live + capability retenida): sin
  reenvio/reset; observacion acotada 180s del ask de readiness -> NUNCA
  llego; test fallo en el poll (3.8m). Gasto LLM: desconocido, no demostrable
  cero.
- Catalogo verificado: zai-coding-plan/glm-5.3 PRESENTE en opencode real
  aislado (55 modelos; check /tmp/opencode/check-opencode-model-catalog.mjs,
  solo ids publicos) — hipotesis modelo-ausente refutada.
- **Probe de arranque no-LLM (1era ejecucion, autorizado): INVALIDO por bug
  del harness** — lei `terminal.screen`/`terminal.text`, campos INEXISTENTES
  del contrato real (`{terminal:{tail:string[]}}`); el `?? ''` fabrido una
  pantalla vacia. ESE RESULTADO NO DEMUESTRA NADA sobre output del TUI.
  Corregido (helper real-agent-screen-evidence.ts + 7/7 unit): shape-guard
  que FALLA ante contrato inesperado, redaccion en memoria de VALORES exactos
  de credenciales (Object.values) antes de filtros genericos, ambas lecturas
  (screen:true + stream) y inspectProcess tipado en UNA ejecucion.
- Equivalencia worker-vs-probe verificada en codigo (no por nombre): ambos
  caminos llaman buildAgentStartupPlan con los mismos inputs
  (cmdOverrides=settings.agentCmdOverrides, agentEnv=agentDefaultEnv,
  sessionOptions=model, platform/shell). Delta unico:
  sessionOptionsOverrideAgentArgs=true en worker — irrelevante cuando
  agentDefaultArgs no esta configurado (nuestro caso).
- Smoke spec: salta con ORCA_E2E_REAL_STARTUP_PROBE=1 (cero gasto durante
  probes). Probe spec:
  tests/e2e/real-opencode-startup-screen-probe.opt-in.spec.ts. NOTA: el
  launcher grepa el archivo del smoke por path; el probe se lanza con su env
  replicado exactamente (misma lista env -u + mismas vars).
- **Probe de arranque corregido, EJECUCION AUTORIZADA (msg_b6104fadc5d7):
  1 passed (22.6s)** — shape real `{terminal:{tail:string[]}}` en ambas
  lecturas (16 lineas, screen:true y stream identicas). El TUI real de
  OpenCode (1.18.29) renderiza COMPLETO y sano: banner, composer
  `Ask anything… "Fix broken tests"`, **modelo cargado `Build · GLM-5.3
Z.AI Coding Plan`**, cwd correcto (repo e2e), footer agents/commands.
  SIN dialogos de onboarding/trust/permisos — hipotesis de arranque-bloqueado
  REFUTADA. Proceso: foreground=opencode, hasChildProcesses=true,
  isRunningAgent=true. Evidence sanitizada (valores redactados en memoria):
  test-results/real-opencode-startup-scre-*/. Conclusion: el fallo del smoke
  NO es de arranque/render; esta en la sumision/observacion del turno del
  composer real (paste+Enter del preamble no inicio turno verificado y el ask
  jamas llego en 180s), con TUI sano y modelo listo.
- Core cerro el navspec en paralelo: **web 4/4 verde (1.6m, test1 24.8s)**
  via precondicion de setup RPC en fixtures (sin cambios src).

## Guard de env ambiental pre-credenciales (msg_1d9a3116b42a)

`createElectronHomeIsolation` solo aisla HOME/CODEX; overrides XDG/OpenCode/Pi
heredados del proceso de test sobrevivirian y apuntarian al agente real a
config/sesiones vivas. Guard agregado SOLO al smoke real (opt-in spec), antes
de host/LLM: `tests/e2e/helpers/real-agent-ambient-env-guard.ts` +
`assertCleanRealAgentAmbientEnv()` al inicio de `runRealAgentSmoke`.

Lista guardada (nombres; valores nunca se reportan): `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `OPENCODE_CONFIG`,
`OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_SOURCE_CONFIG_DIR`,
`PI_CODING_AGENT_DIR`, `PI_SOURCE_AGENT_DIR`, `PI_SESSION`. Rechaza valores
NO VACIOS (cadena vacia cuenta como ausente); reporta solo nombres.
Desviaciones verificadas contra el repo: `OPENCODE_SOURCE_CONFIG_DIR` y
`PI_SOURCE_AGENT_DIR` anadidos como variantes existentes
(`src/main/ipc/pty/host-env/assembly.ts`); `PI_SESSION` en lugar de
`PI_SESSION_DIR` (`PI_SESSION_DIR` no existe en el repo; la variable real de
sesion Pi es `PI_SESSION`, ver
`src/main/runtime/orchestration/worker-transcript-pi.ts`).

Unit: 4/4 verdes (`real-agent-ambient-env-guard.unit.test.ts`). Simulado
re-ejecutado con el wiring: 1 passed (16.0s). tsc e2e: archivos propios
limpios.

Comando Gate B propuesto (limpieza solo del proceso de test, env -u; HOME
aislado existente; credenciales via agentDefaultEnv desde
ORCA_E2E_REAL_AGENT_ENV_JSON):

```
env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_CACHE_HOME -u XDG_STATE_HOME \
    -u OPENCODE_CONFIG -u OPENCODE_CONFIG_DIR -u OPENCODE_CONFIG_CONTENT \
    -u OPENCODE_SOURCE_CONFIG_DIR -u PI_CODING_AGENT_DIR -u PI_SOURCE_AGENT_DIR \
    -u PI_SESSION \
  xvfb-run --auto-servernum env ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1 \
    TMPDIR=/tmp/opencode ORCA_E2E_REAL_OPENCODE=1 ORCA_E2E_REAL_AGENT_LLM=1 \
    ORCA_E2E_REAL_OPENCODE_MODEL=<model> ORCA_E2E_REAL_AGENT_ENV_JSON=<path> \
  node_modules/.bin/playwright test \
    tests/e2e/multi-client-orchestration-real-agents.opt-in.spec.ts \
    --config tests/playwright.config.ts --project electron-headless --workers=1
```

## Gates pendientes

1. **Rebuild tras OBS3c + rerun final simulado y web**: el src actual tiene
   ediciones OBS3c; el guard rehusara hasta el nuevo gate. Rerun con la fase 6
   endurecida (tercer worker) y el complemento web.
2. **Smoke real OpenCode/Pi** (NO aprobado): la spec incorpora los blockers de
   revision; faltan modelo exacto, JSON de credenciales (lo crea el coordinador)
   y approval de gasto LLM.

## Limites honestos

- El E2E simulado valida el contrato de orquestacion con fake agents que SI usan
  los endpoints reales de hooks y CLI; no valida binarios OpenCode/Pi reales.
- Los clientes son conexiones RPC persistentes, NO dos apps desktop; el complemento
  web cubre navegacion multicliente pero no es control-plane RPC completo.
- La variante "cierre ya registrado + ptyKilled:false" (revision 1b) sigue sin
  fixture: el fake agent no se cierra solo. Pendiente.
- `workerRead` transcript (sesion exacta de proveedor) con agentes reales queda
  para el smoke; el simulado cubre fallback explicito y archivo congelado.
