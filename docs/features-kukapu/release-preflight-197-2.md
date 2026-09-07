# Preflight de la release 1.4.197-kukapu.2: validacion aislada y entrega

- Fecha: 2026-09-06. Run `run_3bc1b0c65acb`, tarea `task_74d54f396ccc`.
- Naturaleza: inspeccion SOLO LECTURA de codigo y produccion. Ningun arranque/parada,
  build, install, pnpm ni escritura git. Unico artefacto escrito: este documento.
- Checkout auditado: `/home/kukapu/dev/projects/orca`, base `ee2e5da315` con cambios sin
  commit de los bloques 1-3 en curso (workers en paralelo).

## 1. Produccion identificada (lectura)

- `orca status` / `orca-ide status --json`: runtime `3aae6f99-a1d9-4c8f-87e9-579518628130`
  `ready`, `appVersion: 1.4.197-kukapu.1`, PID 2085131. Coincide con el runbook y con
  `docs/features-kukapu/orchestration-run-197-2.md`.
- Actualizacion remota: `installMode: interactive`, `automatic: false`
  (`updater-unavailable`) — toda instalacion es manual via script root.
- Unidades systemd (ambas `enabled`, `active`):
  - `orca-server.service` (`/etc/systemd/system/orca-server.service`):
    `ExecStart=/opt/orca/orca-linux.AppImage serve --port 6768 --pairing-address 192.168.0.139 --json`,
    `User=kukapu`, `Restart=on-failure`, ordenada tras `orca-xvfb.service`.
  - `orca-xvfb.service`: `Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp`.
- Paths: `/opt/orca/VERSION` = `v1.4.197-kukapu.1`; binario
  `/opt/orca/orca-linux.AppImage`; backups en `/opt/orca/backups/`.
- Cadena CLI: `~/.local/bin/orca` (script 118 B) y `~/.local/bin/orca-ide` (symlink) ->
  `~/.cache/orca/appimage/launcher/orca-ide` (espera <=5 s el symlink `installed`) ->
  extract content-addressed `~/.cache/orca/appimage/01440e671d0a81cc6672bde9/ca577e8d90d1e7ba89b401fc/`.
  El puntero `installed` se regenera al arrancar el servicio; durante un swap el CLI
  degrada con mensaje claro, no corrompe.
- Puerto 6768 escuchando (unico de 6768/6799/6800 ocupado); 6799/6800+ libres para smoke.
- Recursos: 61 GiB RAM disponible, /tmp 35 GiB libres, / 1.5 TiB libres. Suficiente para
  build + e2e aislados en paralelo con produccion (cgroup de produccion usa 28.8 GiB).
- Marker opaco `/opt/orca/orca-rollback-2026-08-20-213334.ready` (root, 0700): sin
  referencia en el codigo actual; no tocar, solo documentar.

## 2. Impacto de reinicio del runtime (gate critico)

`systemctl restart orca-server.service` mata TODO el cgroup
`/system.slice/orca-server.service` (1597 tareas). Dentro hay, verificado por
`systemctl status`: todos los PTYs (`bash --rcfile ~/.config/orca/shell-wrappers/...`),
el coordinador y este worker, los implementadores actuales (`opencode --model
zai-coding-plan/glm-5.3`, `opencode --model xai/grok-4.6`), un `opencode` de sync
upstream, `codex`, language servers (elixir/yaml/ts/bash/eslint), `daemon-entry.js`,
`session-scanner-service-entry.js`, `computer-sidecar.js` y Chrome.

- Sobrevive: estado durable en disco (`orchestration.db` sqlite bajo `~/.config/orca`,
  AI Vault, docs, backups). Run/Task/Dispatch/mensajes con ACK son recuperables.
- No sobrevive: procesos y turnos en vuelo; el coordinador pierde su terminal y este
  worker su PTY. Un reinicio desde un worker destruye la orquestacion que lo creo.
- Conclusion: instalacion/reinicio SOLO desde un ejecutor externo al cgroup (sesion SSH
  directa del usuario o consola), con checkpoint del Run registrado fuera del proceso y
  ventana sin trabajos activos.
- Permiso: este worker tiene `sudo`/`doas`/`su` denegados por reglas de permisos. Ningun
  worker puede ejecutar los pasos root (backup/swap/VERSION/restart). Es un bloqueo
  intencional y util: la instalacion es manual del usuario o del coordinador con
  credenciales propias fuera de Orca.

## 3. Rollback disponible

- `/opt/orca/backups/`: 6 AppImages con timestamp (`orca-linux.AppImage.20260829T222514Z`
  ... `orca-linux.AppImage.20260904T071058Z` — este ultimo es el activo actual) y
  `orca-state-before-1.4.180/` (estado pre-1.4.180).
- Patron instalador probado (release .1): `/tmp/opencode/install-orca-v1.4.197-kukapu.1.sh`
  (lectura): valida ELF del `dist/orca-linux.AppImage`, `cp -a` backup timestampado,
  `install` atómico `.new` + `mv`, escribe `/opt/orca/VERSION`,
  `systemctl reset-failed + restart orca-xvfb orca-server`, `sleep 6`, `is-active`,
  `ss -ltn :6768`, `journalctl -n 10`. Adaptar `VER` para la .2; requiere root.
- Rollback manual: copiar el backup deseado sobre `/opt/orca/orca-linux.AppImage`,
  reescribir `/opt/orca/VERSION`, reiniciar ambas unidades. El launcher del CLI se
  re-deriva solo al arrancar. Duracion estimada del corte: la del restart (~6-10 s).

## 4. Harness existente para validacion aislada (bloque 4)

### 4.1 Runtime server + cliente real emparejado (sin Electron UI)

- `config/scripts/runtime-serve-terminal-smoke.mjs` (script `smoke:serve-terminal`):
  arranca el build del checkout `out/main/index.js --serve --serve-port <6800+offset>
  --serve-json --user-data-dir=<mkdtemp>`, empareja el CLI construido (`out/cli/index.js`,
  `--pairing-code` explicito), registra un repo temporal, crea worktree + terminal,
  exige el round-trip PTY completo y el shutdown limpio. Aislamiento: userData mkdtemp,
  puerto alto, repo semilla desechable.
- Invocacion: `node config/scripts/runtime-serve-terminal-smoke.mjs`
  (opciones: `--target orcad`, `ORCA_SMOKE_PORT_OFFSET`, `ORCA_SMOKE_ELECTRON`).
- Limitaciones: un solo cliente; `ORCA_SMOKE_ELECTRON=<bin>` ejecuta ese binario como
  runtime de Electron PERO sobre `out/main/index.js` del checkout, no sobre el bundle del
  artefacto — no sirve como smoke del AppImage empaquetado.

### 4.2 Dos clientes sobre el mismo runtime

- `tests/e2e/multi-client-navigation-isolation.spec.ts` (4 tests, corridos via
  `pnpm test:e2e:multi-client-navigation` -> `config/scripts/run-multi-client-navigation-e2e.mjs`):
  host Electron + DOS clientes web emparejados por pairing URL (`BrowserWindow show:false`,
  `partition` unica por cliente). Cubre navegacion por worktrees independiente,
  create-with-agent sin mover al observador, menus solo-provider y folder browsing
  rutado al host. Es el harness "servidor + dos clientes" mas cercano existente.
- Cadena sin pnpm (equivalente exacto):
  1. `node config/scripts/ensure-native-runtime.mjs --runtime=electron` (solo chequea;
     recompila unicamente si los modulos nativos no cargan).
  2. `node config/scripts/run-electron-vite-build.mjs --mode e2e` (expone `window.__store`;
     ver `tests/e2e/AGENTS.md`) y build del CLI (seccion 5.2).
  3. `node config/scripts/run-vite-web-build.mjs && node config/scripts/verify-web-build.mjs`
     (el cliente web que cargan los clientes emparejados; el runner oficial lo dispara
     con `ORCA_E2E_WEB_CLIENT=1`).
  4. `ORCA_BACKGROUND_LAUNCH=1 ORCA_E2E_WEB_CLIENT=1 SKIP_BUILD=1 node_modules/.bin/playwright test tests/e2e/multi-client-navigation-isolation.spec.ts --config tests/playwright.config.ts --project electron-headless --workers=1`
- Hueco: NO existe spec de orquestacion (worker-start/ask/worker_done) observada por dos
  clientes a la vez. El bloque 4 necesita una spec nueva que reutilice este fixture.

### 4.3 Agentes reales vs simulados (cobertura real)

| Superficie | Estado | Evidencia |
| --- | --- | --- |
| Ciclo de vida orquestacion (start/settlement/release/ask/mail/recovery) | SIMULADO con agentes falsos via PATH + `agentCmdOverrides` | `tests/e2e/helpers/fake-agent-command-override.ts`, fixtures `tests/e2e/fixtures/golden-stub-agent/` (`codex`, `claude`, `grok`, `golden-stub-agent`); specs `orchestration-idle-mail-delivery` (10 tests), `orchestration-worker-settlement-release-cli`, `orchestration-low-level-dispatch-release`, `orchestration-legacy-worker-restart-recovery`, `orchestration-legacy-worker-missing-terminal-recovery`, `completed-worker-retirement-resume` |
| OpenCode real, sin LLM | EXISTE, gated | `tests/e2e/terminal-opencode-emoji-table-rendering.spec.ts` test `local real OpenCode demo...` con `ORCA_E2E_REAL_OPENCODE=1`: escribe `opencode run --demo --interactive "Give me markdown table dummy data a long table with emojis in it"` + Ctrl-C en finally |
| Pi real | NO EXISTE smoke alguno | unico e2e Pi es render de titulo (`tests/e2e/ssh-pi-compatible-agent-title.spec.ts`); pi 0.85.0 esta en PATH (mise) |
| Modelos/evidence del proveedor (OBS-01) | No cubierto por harness real | bloque 2/3 en curso |

Comando smoke OpenCode (una vez autorizado, con build e2e listo):

```bash
ORCA_BACKGROUND_LAUNCH=1 ORCA_E2E_REAL_OPENCODE=1 node_modules/.bin/playwright test \
  tests/e2e/terminal-opencode-emoji-table-rendering.spec.ts \
  --config tests/playwright.config.ts --project electron-headless --workers=1 \
  --grep "real OpenCode demo"
```

Para Pi queda pendiente definir un smoke acotado equivalente (verificar primero si el
fork local de Pi 0.85 soporta un modo demo/no-network; no lanzarlo a ciegas).

### 4.4 Electron/CDP oculto

- `tests/playwright.config.ts`: proyecto `electron-headless` (`grepInvert @headful`),
  `electron-headful` solo para `@headful`. Fixture `tests/e2e/helpers/orca-app.ts`
  lanza con `_electron.launch()` (CDP), home aislado
  (`tests/e2e/helpers/electron-home-isolation.ts`), repo semilla propio, cleanup de
  daemons (`electron-process-shutdown`), `launchEnv` por spec.
- Politica `tests/AGENTS.md` + `AGENTS.md` raiz: siempre `ORCA_BACKGROUND_LAUNCH=1`
  (o `ORCA_E2E_HEADLESS=1`); jamas `show()`/`bringToFront()`/`app.focus()`.
- Display: este worker hereda `DISPLAY=:99` (el Xvfb de produccion). Las ventanas
  headless nunca se muestran, pero comparten servidor X con produccion; alternativa
  mas conservadora: `xvfb-run --auto-servernum dbus-run-session -- ...` (patron CI,
  p.ej. `.github/workflows` package-electron-runtime-contract).
- `global-setup` reconstruye con `--mode e2e`; `SKIP_BUILD=1` solo es valido con un
  `out/` construido en ese modo (si todo falla con timeout en `window.__store`, el build
  esta rancio — ver `tests/e2e/AGENTS.md`).
- El skill `$electron` citado en `AGENTS.md` no aparece en `~/.claude/skills`,
  `~/.agents/skills` ni `skill-guides/`; el flujo operativo equivalente es el de arriba.
  Confirmar con el coordinador si se esperaba un skill instalado.

## 5. Build y entrega (bloque 5)

### 5.1 Sellado de version

- `ORCA_LOCAL_BUILD_VERSION` lo consume `config/electron-builder.config.cjs:41-42,158-159`
  como `extraMetadata.version` (salvo mac-release/win-dev-channel). `/opt/orca/VERSION` y
  `appVersion` derivan del artefacto. `package.json` actual: `1.4.197` (base); objetivo
  `1.4.197-kukapu.2`. No fingir el tag upstream `v1.4.197`.

### 5.2 Cadena `build:linux` descompuesta en invocaciones node (sin pnpm)

Motivo: pnpm 12 puede autoinstalar dependencias al correr scripts (ya ocurrio una vez,
  ver plan). Todo lo abajo es node-direct y no autoinstala. Ejecutar desde la raiz del
  checkout, idealmente con `TMPDIR=/tmp/opencode`:

1. Typecheck (3 proyectos en paralelo, invoca tsc con node):
   `ORCA_BACKGROUND_LAUNCH=1 node config/scripts/run-typecheck-projects-in-parallel.mjs`
2. Relay: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/build-relay.mjs`
3. CLI: `node node_modules/typescript/bin/tsc -p config/tsconfig.cli.json --outDir out --composite false --incremental false && node config/scripts/verify-cli-bin.mjs --fix-executable --fix-package-json && node config/scripts/install-dev-cli.mjs`
   - `install-dev-cli.mjs` intenta `ln -s` a `/usr/local/bin/orca-dev`: verificado que
     `/usr/local/bin` NO es escribible por kukapu y el enlace no existe -> falla con
     mensaje y exit 0. No modifica shims globales del usuario (`~/.local/bin/orca*`
     intocados).
   - `verify-cli-bin --fix-*` solo toca `out/` y bits de ejecucion del repo.
4. Electron bundle: `node config/scripts/run-electron-vite-build.mjs` (para e2e usar
   `--mode e2e`; lanza `node .../electron-vite/bin/electron-vite.js build`).
5. Skills CLI: `node config/scripts/verify-skills-cli-runtime.cjs out`
6. Web client: `node config/scripts/project-renderer-web-client.mjs && node config/scripts/verify-web-build.mjs`
7. Runtime nativo: `node config/scripts/ensure-native-runtime.mjs --runtime=electron` —
   chequea node-pty contra el Electron 43.4.1 de `node_modules/electron/dist`; SOLO
   recompila (`rebuild-native-deps.mjs`) si no carga o esta parcheado.
8. Empaquetado (rpm omitido igual que 196/197.1 — sin rpmbuild):

```bash
ORCA_LOCAL_BUILD_VERSION=1.4.197-kukapu.2 ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1 \
  node node_modules/electron-builder/cli.js \
  --config config/electron-builder.config.cjs --linux AppImage deb --x64
```

- `beforeBuild` (`config/electron-builder.config.cjs:633` ->
  `config/scripts/electron-builder-native-rebuild.cjs`) SIEMPRE corre
  `rebuild-native-deps.mjs --platform --arch`, con `--force` salvo
  `ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1` con platform/arch = host (patron CI
  `.github/workflows/pr.yml:750`). Sin `--force` hace probe y salta si ya cargan
  ("Native modules already load in Electron; skipping rebuild"). Si el coordinador
  prefiere recompilar, quitar la variable y aceptar el node-gyp de node-pty.
- Gates automaticos al empaquetar: `afterPack` ejecuta
  `verifyLinuxGlibcFloor` (`config/scripts/verify-linux-glibc-floor.cjs`; suelo
  Ubuntu 20.04 glibc 2.31 / GLIBCXX 3.4.28), verificacion de daemon empaquetado y
  contrato estatico de AppImage. No hay que invocarlos a mano.
- Salida: `dist/orca-linux.AppImage` (+ `.deb`). `dist/` y `out/` actuales contienen
  artefactos del 2026-09-04 (release .1): NO reutilizar sin rebuild.

### 5.3 Smoke del artefacto sin tocar produccion

1. Contrato CLI en Docker (docker 29.7.2 operativo; ubuntu 24.04 sin FUSE/userns):
   `node config/scripts/run-linux-cli-launch-contract-docker.mjs --appimage dist/orca-linux.AppImage`
2. Serve aislado (runbook `docs/features-kukapu/local-build-deployment.md`):
   `HOME`/`XDG_CONFIG_HOME`/`--user-data-dir` aislados bajo /tmp/opencode y puerto 6799
   (verificado libre); emparejar el CLI construido con `--pairing-code` como hace el
   smoke 4.1. Nunca puerto 6768 ni el HOME real.

### 5.4 Instalacion (sujeta al gate)

- Requiere root + ejecutor externo al cgroup (seccion 2). Patron del script .1
  (seccion 3) adaptando `VER=v1.4.197-kukapu.2`. Los workers no pueden ejecutarla
  (sudo denegado). Antes: `docs/features-kukapu/orchestration-run-197-2.md` exige
  checkpoint recuperable y comprobar el efecto sobre agentes activos.

## 6. Blockers precisos

1. Reinicio del servicio destruye coordinador, PTYs e implementadores (cgroup entero).
   Instalacion solo con checkpoint externo y ventana sin trabajos activos.
2. Workers sin sudo (reglas de permisos): pasos root manuales del usuario/coordinador.
3. Falta harness dos-clientes + orquestacion real y smoke Pi acotado: el bloque 4 tiene
   que crear una spec nueva y definir el modo Pi sin LLM antes de autorizar pruebas.
4. pnpm prohibido para workers: usar la cadena node-direct de 5.2; cualquier
   `pnpm run ...` puede disparar autoinstall.
5. Rebuild nativo: sin `ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1` el empaquetado fuerza
   node-gyp; decidirlo explicitamente, no dejarlo al azar.
6. `out/`+`dist/` rancios (2026-09-04, sin los cambios de bloques 1-3): todo build/smoke
   de la .2 requiere rebuild completo del checkout actual.
7. Skill `$electron` no localizado en las ubicaciones habituales: confirmar si falta
   instalarlo o si la referencia es al flujo Playwright del repo.

## 7. Pasos aislados ejecutables propuestos (NO ejecutados)

1. Build aislado de la .2 con la cadena 5.2 (sin pnpm), decidiendo antes la politica de
   rebuild nativo (5.2 punto 8).
2. Smoke Docker del AppImage (5.3.1) + serve aislado en 6799 con datos/port/HOME
   desechables (5.3.2).
3. e2e multicliente sin pnpm (4.2, pasos 1-4) contra el checkout de la .2.
4. Spec nueva (bloque 4): dos clientes emparejados observando un worker orchestration
   con agente falso; despues smoke real OpenCode (`ORCA_E2E_REAL_OPENCODE=1`) y el
   equivalente Pi cuando exista modo acotado.
5. Preparar script instalador .2 (copia adaptada del patron .1) + plan de rollback
   (backup timestampado + VERSION + restart) y DEJARLO como artefacto pendiente del gate.
6. Instalacion: solo el usuario/coordinador con root externo, checkpoint previo y
   verificacion post-install (`orca-ide status --json`, `systemctl is-active`, 6768,
   spawn + worker_done de prueba).

## 8. Comandos de solo lectura efectivamente ejecutados

`orca status`; `orca-ide status --json`; `systemctl list-units/list-unit-files/show/status`
de `orca-server` y `orca-xvfb` (sin journal privado); `ls`/`cat` de `/opt/orca`
(VERSION, backups), `/tmp/opencode/install-orca-*.sh`, `~/.local/bin/orca*`,
`~/.cache/orca/appimage/launcher/*`; `ss -ltn`; `docker --version`+`ps`;
`opencode --version`, `pi --version`; lecturas del repo citadas inline. Sin secretos
volcados ni env completo. `sudo -n true` fue bloqueado por las reglas de permisos del
worker (hallazgo, no incidencia).
