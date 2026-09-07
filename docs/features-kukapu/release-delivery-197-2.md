# Entrega 1.4.197-kukapu.2 — compilacion y preparacion de empaquetado

Fecha: 2026-09-06 (bloque 5, Task `task_17ab1540aa58` / Dispatch `ctx_f57de1214eaf`).
Autorizacion del coordinador recibida por `ask` antes de compilar: TS/relay/CLI/
electron-vite produccion/web + verificadores locales; RECHAZADO `install-dev-cli`,
`ensure-native-runtime` normal y rebuild forzado; empaquetado queda en GATE FINAL
PACK; sin installs/restarts/LLM/produccion.

## Provenance de lo compilado

- HEAD: `ee2e5da3155adab7d15094d1445be8d1f030941b` (`main-kukapu`).
- Arbol sucio: cambios tracked y archivos untracked de fuentes/tests/docs;
  el manifiesto conserva la lista capturada para el empaquetado.
- Manifiesto completo con sha256 de diff tracked y de cada untracked:
  `dist/release-1.4.197-kukapu.2/source-provenance.txt`.
  `git diff` solo cubre tracked; los untracked se hashean archivo a archivo.

## Compilacion ejecutada (node-direct, sin pnpm, TMPDIR=/tmp/opencode)

| Paso      | Comando                                                                                                                                                                                              | Resultado                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Typecheck | `ORCA_BACKGROUND_LAUNCH=1 node config/scripts/run-typecheck-projects-in-parallel.mjs`                                                                                                                | exit 0                    |
| Relay     | `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/build-relay.mjs`                                                                                                                 | 8 targets + WSL ok        |
| CLI       | `node node_modules/typescript/bin/tsc -p config/tsconfig.cli.json --outDir out --composite false --incremental false` + `node config/scripts/verify-cli-bin.mjs --fix-executable --fix-package-json` | verified out/cli/index.js |
| Electron  | `ORCA_BACKGROUND_LAUNCH=1 node config/scripts/run-electron-vite-build.mjs` (produccion, SIN e2e mode)                                                                                                | main+preload+renderer ok  |
| Skills    | `node config/scripts/verify-skills-cli-runtime.cjs out`                                                                                                                                              | 520 closures, 5 comandos  |
| Web       | `node config/scripts/project-renderer-web-client.mjs` + `node config/scripts/verify-web-build.mjs`                                                                                                   | 917 archivos, 44.1 MiB    |

Timestamps out/: cli 21:10:26, main 21:10:32, preload 21:10:32,
relay 21:10:22, web 21:10:45 (UTC 2026-09-06).

## Precheck nativo (solo lectura, aprobado por coordinador)

- `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron
config/scripts/ensure-native-runtime.mjs --check-only` → exit 0
  (los modulos nativos cargan bajo Electron 43.4.1; es hijo puro, no reconstruye).
- `node_modules/node-pty/build/Release/pty.node` existe (build parcheado del
  2026-09-03) → `getPatchedNodePtyRebuildReason()` = null.
- Con `ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1` (x64 linux = host),
  `electron-builder-native-rebuild.cjs` omite `--force` y
  `rebuild-native-deps.mjs` tomara el camino "Native modules already load in
  Electron; skipping rebuild" (probe OK + patched-reason null, fuente lineas
  94-106). No reconstruye ni instala deps.
- Tools de empaquetado en cache `~/.cache/electron-builder`:
  `appimage@1.0.3` (coincide con `toolsets.appimage` del config), `fpm@2.1.4`,
  `7zip@1.0.0`, `icons@1.1.0`. No se espera descarga.

## GATE FINAL PACK (ejecutado 2026-09-06; dos pasadas)

Comando (autorizado por coordinador, ambas pasadas identico):

```bash
ORCA_BACKGROUND_LAUNCH=1 ORCA_LOCAL_BUILD_VERSION=1.4.197-kukapu.2 \
  ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1 TMPDIR=/tmp/opencode \
  node node_modules/electron-builder/cli.js \
  --config config/electron-builder.config.cjs \
  --linux AppImage deb --x64 \
  --config.directories.output=dist/release-1.4.197-kukapu.2 --publish never
```

### Primer pack: INVALIDADO (21:16 UTC)

- `PACK_EXIT=0` y gates afterPack verdes, PERO `app.asar` = 1.6 GB: al mover
  `directories.output` a `dist/release-1.4.197-kukapu.2`, electron-builder
  dejo de excluir `dist` completo (solo auto-excluye el subdir de salida) y el
  asar arrastro 1695 entradas de `dist/` previo (`linux-unpacked` .1 526 MB,
  AppImage .1, 5 debs) mas 5 archivos de `test-results` (184 KB). Verificado
  listando el asar (`@electron/asar`). Artefactos borrados SOLO los creados
  por esta Task; `.1` y outputs ajenos intactos. Un exit 0 no es release verde.

### Fix minimo autorizado (ajuste de empaquetado)

- `config/electron-builder.config.cjs` `files` += `!dist{,/**/*}` y
  `!{test-results,playwright-report}{,/**/*}` (patron existente de
  pr-evidence).
- Regresion en `config/scripts/electron-builder-config.test.mjs` (matcher real
  FileMatcher: dist viejo/nuevo, test-results, playwright-report excluidos;
  out/main sigue dentro). 29/29 tests verdes + oxlint limpio.
- TS/produccion SIN rebuild (out/ 21:10 intacto); solo re-empaquetado.

### Segundo pack: VALIDO (21:20 UTC, PACK_EXIT=0)

- Gates automaticos: `[rebuild] Native modules already load in Electron;
skipping rebuild.`; `verify-linux-glibc-floor` OK (16 binarios, Ubuntu 20.04
  glibc 2.31 / GLIBCXX 3.4.28); `verify-packaged-daemon-entry` OK;
  `verify-packaged-plugin-resources` OK (1 plugin).
- Verificacion asar: 0 entradas `dist/`, `test-results/`, `playwright-report/`;
  contenido top-level solo out/cloud/resources/raiz; `package.json` interno
  version `1.4.197-kukapu.2`; app.asar 110 MB (antes 1.6 GB invalido).

| Artefacto                                                           | Bytes     | sha256                                                             | sha512                                                                                                                             |
| ------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `dist/release-1.4.197-kukapu.2/orca-linux.AppImage`                 | 193771900 | `1aaf4f255ccd1e825c5b11de094e31c59961a75529515c856028e7efae17d4ba` | `2efbc631d3d66d0cf14a0ce32f5835f41ff84fd82e714cfefda346c36b1cba49733808a7c73fe9c99ecc89f93c114c12f448934fb662627cc63b26599f4ad5a3` |
| `dist/release-1.4.197-kukapu.2/orca-ide_1.4.197-kukapu.2_amd64.deb` | 164736788 | `83226b8516b8e0321728355fe22a373af39e474bde0a69004de3b7da5d0f1363` | `053592d3f8317fba53afa3b34631f569afd3f08f4cc3cc032babc76e946067a55653e851c0daf9aa16ea9f1901f1ae8f77dc78b1e64f92626be98eb4f7a26be9` |

- `latest-linux.yml` version `1.4.197-kukapu.2`, sha512 base64 del AppImage
  coincide con el hash calculado. Manifiesto de fuentes+artefactos:
  `dist/release-1.4.197-kukapu.2/source-provenance.txt` (actualizado post-pack,
  incluye el config modificado).

## Estado De Entrega

- No publicar (`--publish never` ya aplicado), no instalar, no restart.
- Candidato empaquetado y probado localmente; validacion final del coordinador
  incluye version interna, hashes, exclusiones ASAR y evidencias del CLI/serve.

## Smoke Previo Invalidado

Entorno hijo minimo (`env -i`, sin ORCA__/OPENCODE_/PI*/credenciales heredadas),
HOME/USERPROFILE/XDG_*/TMPDIR privados bajo `/tmp/opencode/artifact-smoke`,
`ORCA_BACKGROUND_LAUNCH=1`, `DISPLAY=:99` (Xvfb de produccion, sin ventanas),
puerto 6799 verificado libre antes (nunca 6768 ni kill de ocupantes).

1. CLI empaquetado (`resources/bin/orca-ide`, `ELECTRON_RUN_AS_NODE=1`):
   `--help` exit 0 (427 lineas). `--version` exit 0 imprime `v24.18.1`
   (Node de Electron, help: "print Node.js version"). Es una invocacion
   incorrecta para validar Orca; no se acepta como gate CLI.
2. `serve --port 6799 --json --no-pairing --user-data-dir <privado>` desde
   `dist/release-1.4.197-kukapu.2/orca-linux.AppImage`: escucha en <2 s;
   log sin pairing code/url (grep). runtimeId `9b4b98fb-…56cbb` DISTINTO de
   produccion (`3aae6f99-…`). `/proc/<pid>/exe` = FUSE mount
   `.mount_orca-*/orca-ide` con mountinfo source `orca-linux.AppImage`
   (el .2 lanzado). `GET /` en 6799 → HTTP 200 (sirve el web client del
   artefacto). Estado efectivo integro bajo el smoke dir (XDG
   config/cache/data/state + extract content-addressed en
   `<smoke>/cache/orca/appimage/…`): userData privado verificado con find.
   Version de app del artefacto: asar `package.json` `1.4.197-kukapu.2` +
   `latest-linux.yml` (pack) — el binario en ejecucion es ese AppImage.
3. Cleanup: SIGTERM al PID, puerto liberado, 0 procesos residuales
   (verificado sin auto-match del patron), dir de smoke borrado.

### CORRECCION del smoke previo (revision independiente, 21:3x UTC)

El resultado CLI previo (`--help` 427 lineas, `--version` v24.18.1) era
**Node por una invocacion incorrecta**: probo el runtime Node,
no la CLI empaquetada, y no puede aceptarse como validacion del contrato.
Ademas uso `DISPLAY=:99` de produccion, ya señalado como validacion
insuficiente/indebida para smoke local; el punto 2 (serve) de arriba se
mantiene como evidencia complementaria del artefacto, con esa salvedad de
display. Ambas vias quedan retiradas como oraculo CLI. El smoke correcto
(abajo) usa SOLO el launcher empaquetado `resources/bin/orca-ide`, que
gestiona `ELECTRON_RUN_AS_NODE` internamente (sin forzarlo externamente).

## Smoke LOCAL correcto del CLI empaquetado (ejecutado 21:31 UTC)

AppImage `dist/release-1.4.197-kukapu.2/orca-linux.AppImage` verificado
sha256 `1aaf4f255ccd1e825c5b11de094e31c59961a75529515c856028e7efae17d4ba`
y extraido con `--appimage-extract` a scratch propio
(`/tmp/opencode/orca-197-2-smoke/extract/squashfs-root`, sin red). Entorno
minimo: HOME/XDG__/TMPDIR bajo scratch, sin ORCA__ heredadas, sin token/agent
dirs, `DISPLAY`/`WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR` desmontados (igual que
`run-cli-case.sh:27`), sin ELECTRON_RUN_AS_NODE externo.

Superficies CLI del contrato `config/docker/cli-launch-contract/run-cli-case.sh`
(smoke local, no replica de sus precondiciones ni de toda su matriz de codigos;
timeout 60 s cada uno, resultados en
`/tmp/opencode/orca-197-2-smoke/cli-contract-results.json`):

1. `bundled-help` (`resources/bin/orca-ide --help`): exit 0, 361 lineas,
   header `Usage: orca <command> [options]` presente — es la CLI de Orca,
   no el help de Node (427 lineas).
2. `bundled-version` (`--version`): exit 0, salida EXACTA
   `1.4.197-kukapu.2` (coincide con `app.asar.unpacked/out/package.json`),
   no `v24.18.1`.
3. `bundled-status` (`status --json`): exit 0, JSON `ok: true`.
4. `bundled-skills-help` (`skills --help`): exit 0, `Usage: orca skills <command>`.
5. `bundled-worktree-list` (`worktree list`): exit 1 con error limpio
   "Could not read Orca runtime metadata … Start the Orca app first." —
   comportamiento correcto sin runtime vivo; el host script del contrato
   es dueno del status esperado por caso.

## Smoke serve aislado del artefacto (ejecutado 21:31 UTC)

Launcher empaquetado `serve --no-pairing --port 33327 --json` bajo
`xvfb-run --server-num 100` (display >=100, NUNCA :99), puerto libre
verificado, `ORCA_BACKGROUND_LAUNCH=1`, sin mostrar ventanas. Resultados en
`/tmp/opencode/orca-197-2-smoke/serve-smoke-results.json`:

- Verificacion por CLI local `status --json` (sin imprimir pairing):
  runtimeId `94e5cb59-0ce8-4157-8043-b86e52ab38f5`, appVersion EXACTA
  `1.4.197-kukapu.2`, `runtime.state=ready`, `connectionState=connected`,
  app `running` con PID propio del smoke.
- dataDir aislado verificado: `xdg/config/orca/` bajo el scratch (el error
  de `worktree list` previo al serve apunto al `orca-runtime.json` de ese
  mismo scratch, confirmando el dataDir aislado).
- Cleanup de procesos/puerto PROPIOS unicamente: arbol serve + Xvfb :100
  terminados, puerto 33327 liberado (connection refused verificado), cero
  procesos residuales del smoke.

### Docker cli-contract: OMITIDO con limite explicito

`config/docker/cli-launch-contract/Dockerfile` hace `FROM ubuntu:24.04`
(0 imagenes ubuntu en cache local) y `apt-get` desde archive.ubuntu.com:
requiere pull+apt+red, expresamente no autorizado en este gate. No se
improviso alternativa. El smoke local de arriba replica los casos
`nofuse-userns-bundled-*` del script pero NO las restricciones de entorno
(userns restringido, /dev/fuse ausente) ni los casos de binario directo
`--no-sandbox`.

### Limites del smoke

- Prueba identidad/aislamiento/arranque/serving del artefacto .2 y el
  contrato CLI del launcher empaquetado; NO valida orquestacion completa
  ni LLM sobre el empaquetado, ni los casos Docker de userns/fuse/binario
  directo.
- Candidato aceptado para entrega local con esos limites. No autoriza instalar
  ni publicar; la matriz Docker adversarial sigue sin ejecutarse.

## Limites y estado real

- Empaquetado y smoke local COMPLETADOS; instalacion NO autorizada. `orca-server.service`
  comparte cgroup con coordinador/workers: restart solo desde ejecutor externo
  con checkpoint y ventana segura (ver `release-preflight-197-2.md` secciones 2-3).
- Rollback: backups `/opt/orca/backups/` (activo:
  `orca-linux.AppImage.20260904T071058Z` = .1); patron instalador
  `/tmp/opencode/install-orca-v1.4.197-kukapu.1.sh` adaptable `VER=.2` — no
  asumir que existe en el futuro.
- Sin git commit/stage/stash/push; sin tocar cambios ajenos.
