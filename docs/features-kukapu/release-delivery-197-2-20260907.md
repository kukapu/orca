# Entrega 1.4.197-kukapu.2 — pack fresco 2026-09-07

Pack nuevo en `dist/release-1.4.197-kukapu.2-20260907/` (no toca
`dist/release-1.4.197-kukapu.2/` ni `backup.patch`). Informe de ayer
(`release-delivery-197-2.md`) preservado.

**Estado final 10:44 UTC:** candidato verificado para entrega local. Instalacion
pendiente del usuario desde terminal externa; no instalado ni publicado.

## Provenance

- Fuente: commit `42ab555177` (upstream `314506003a` integrado, checkpoint
  `3c91` protegido). `git status` vacio al inicio del build (10:11 UTC); este
  informe y la nota de release se escribieron despues y se incluyen en el commit
  documental de entrega del principal. Ese commit no cambia el codigo empaquetado.
- `package.json` SHA-256 identico: `c6e53d7433f5ee68a806649a218444889e6a6677fad27a1ce5db8b39a7cc121c`.
- Sin pnpm. Comandos node-direct, en orden:
  1. `node config/scripts/ensure-native-runtime.mjs --runtime=electron --check-only` (exit 0; sin rebuild)
  2. `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/build-relay.mjs`
  3. `node node_modules/typescript/bin/tsc -p config/tsconfig.cli.json --outDir out --composite false --incremental false` (exit 0)
  4. `node config/scripts/verify-cli-bin.mjs --fix-executable --fix-package-json`
  5. `env -u VITE_EXPOSE_STORE node config/scripts/run-electron-vite-build.mjs` (production, sin `--mode e2e`)
  6. `env -u VITE_EXPOSE_STORE node config/scripts/verify-skills-cli-runtime.cjs out`
  7. `env -u VITE_EXPOSE_STORE node config/scripts/project-renderer-web-client.mjs`
  8. `env -u VITE_EXPOSE_STORE node config/scripts/verify-web-build.mjs`
  9. `env ORCA_LOCAL_BUILD_VERSION=1.4.197-kukapu.2 ORCA_REUSE_PREPARED_NATIVE_RUNTIME=1 ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/electron-builder/cli.js --config config/electron-builder.config.cjs --linux AppImage deb --x64 --config.directories.output=dist/release-1.4.197-kukapu.2-20260907 --publish never`
- `install-dev-cli.mjs` omitido (habria intentado escribir `/usr/local/bin`).

## Paquete

- `beforeBuild` no recompilo node-pty: cache verificado ("Native modules already
  load in Electron; skipping rebuild"). Sin rebuild forzado.
- Gates afterPack verdes: glibc floor 2.31 (16 binarios), daemon-entry bajo
  Node plano, 1 plugin.

| Artefacto | Bytes | SHA-256 |
| --- | --- | --- |
| `orca-linux.AppImage` | 195046613 | `4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483` |
| `orca-ide_1.4.197-kukapu.2_amd64.deb` | 165434128 | `ef7b6602c836f1a2d6ab1b0dbab20e395171c7629d385650bf8702a6d7501c67` |

SHA-512 del AppImage en `/tmp/opencode/appimage-sha512.txt`
(`566568f955fecd943e70fca9aad63d12c1ca3dd1aa5da4fa0e1bce8cde45d77b8f35106c7e63e11f85fc9450b6f57f5bd6e955169555e2a8be22d9d13b06c5c2`).

## ASAR

- Version: `1.4.197-kukapu.2`. 3842 ficheros.
- Cero coincidencias: `dist/`, `test-results`, `playwright-report`,
  `config/runtime-auth`, `.env`. 8 hits de `credential` son codigo fuente
  (credential-store, mensajes, prompts), no secretos.
- Lectura con API en memoria (`@electron/asar` `listPackage`) y `extractFile`
  solo para `package.json`; nada extraido al repo.

## Verificacion cruzada 2026-09-07 ~10:22 UTC (solo lectura)

- Revision del coordinador: el SHA-256 del deb tenia solo 52 caracteres, aunque
  el worker lo dio por coincidente. La comparacion automatica contra los bytes
  del artefacto lo rechazo; tabla corregida con los 64 caracteres completos.
- `latest-linux.yml`: sizes 195046613 / 165434128 y sha512 base64 del AppImage
  decodifican exactamente al SHA-512 del fichero.
- Bundles production (`out/renderer`, `out/web`): sin cadena
  `VITE_EXPOSE_STORE`; `__store` solo aparece tras `exposeStore &&` (falso en
  production), mismo chunk `store-DcgtToqJ.js` en ambos.
- El coordinador comparo esos chunks y preload dentro del ASAR con `out/`:
  bytes identicos. Preload tiene `MODE: production`, sin `VITE_EXPOSE_STORE`;
  el fallback compilado es `pP=!1` (renderer) / `Dw=!1` (web). La presencia del
  texto `__store` tras el guard no significa que este expuesto.
- Gates desde `/tmp/opencode/pack-1972.log` (sin repetir pack): rebuild nativo
  saltado por cache, glibc floor 2.31 OK (16 binarios), daemon-entry OK, 1 plugin OK.
- `node /tmp/opencode/verify-delivery-1972.mjs`: exit 0 tras corregir la tabla;
  SHA-256 y bytes de ambos artefactos, SHA-512 y metadata de `latest-linux.yml`,
  version ASAR y exclusiones comprobados con aserciones. Inspeccion ASAR en memoria.

## Preflight Del Coordinador

Ejecutado el 2026-09-07, exit 0, sin sudo ni mutaciones:

```bash
bash config/scripts/install-local-linux-release.sh \
  --artifact /home/kukapu/dev/projects/orca/dist/release-1.4.197-kukapu.2-20260907/orca-linux.AppImage \
  --version v1.4.197-kukapu.2 \
  --sha256 4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483 \
  --preflight
```

Resultado: `mode=preflight (no mutation)`, `cgroup_blocked=yes`,
`orca_env_blocked=yes`. Este Run no puede ejecutar apply. Produccion sigue
`1.4.197-kukapu.1`, runtime `3aae6f99-a1d9-4c8f-87e9-579518628130`, `ready`.
Ambos servicios activos, con PIDs y fechas de arranque originales comprobados.

## Smoke Aceptado

QA `ctx_2d3e87622e42` termino a las 10:40:57Z en su sesion conservada, con
`opencode-go/muse-spark-1.3-contributor`. Informe y limitaciones:
[artifact-smoke-197-2-20260907.md](./artifact-smoke-197-2-20260907.md).

El coordinador cerro los huecos de evidencia con una corrida del AppImage real:
help/version `.2`, runtime `10d69f91-1ba8-4fb4-a1d7-ad9f16d60edc`, metadata
privado con PID/runtimeId coincidentes con status, HTTP 200 en puerto `35719`,
SIGTERM exit 0, PID terminado, puerto liberado y HOME eliminado. Xvfb propio
`:100`, entorno minimo, sin secretos ni LLM. Resultado con aserciones exit 0.
Los probes de QA con aislamiento incompleto o campos ready ausentes no cuentan
como verdes; estan documentados junto a la correccion.

## Instalacion Externa (Solo El Usuario)

No ejecutar dentro de Orca, ni siquiera con sudo. El restart termina este
coordinador y los PTYs del servicio. Elegir una ventana sin trabajos activos y
conservar este checkpoint antes de instalar. El instalador guarda binario y
`VERSION`, pero **no** el estado: tomar por separado una copia consistente del
directorio de datos de produccion antes de aplicar (no copiar SQLite en caliente
como si fuese un backup consistente).

Desde SSH o consola externa, con el candidato ya verificado:

```bash
sudo bash /home/kukapu/dev/projects/orca/config/scripts/install-local-linux-release.sh \
  --artifact /home/kukapu/dev/projects/orca/dist/release-1.4.197-kukapu.2-20260907/orca-linux.AppImage \
  --version v1.4.197-kukapu.2 \
  --sha256 4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483 \
  --apply --confirm=INSTALL
```

Conservar las rutas `backup_binary=` y `backup_version=` que imprima apply.
Despues, desde esa misma terminal externa:

```bash
systemctl is-active orca-server.service orca-xvfb.service
orca --version
orca status --json | jq '{ok, runtime: (.result.runtime | {runtimeId, appVersion, state})}'
```

Exigir version `1.4.197-kukapu.2`, runtime `ready` y runtimeId distinto del de
produccion anterior. El instalador comprueba servicios y puerto, pero esos
checks por si solos no demuestran la version activa. No publicar JSON de pairing.

Rollback binario manual, tambien desde fuera de Orca. Sustituir `<UTC>` por el
MISMO sello de las dos rutas de backup impresas por esa instalacion:

```bash
sudo systemctl stop orca-server.service
sudo cp -a /opt/orca/backups/orca-linux.AppImage.<UTC> /opt/orca/orca-linux.AppImage
sudo cp -a /opt/orca/backups/VERSION.<UTC> /opt/orca/VERSION
sudo systemctl restart orca-xvfb.service orca-server.service
```

Este rollback no revierte migraciones SQLite ni otro estado; restaurar estado
requiere la copia consistente previa y una decision separada. Si falla health
despues del swap, el instalador no promete rollback automatico del servicio.

## Limites

- Smoke local sin LLM aprobado; no equivale a orquestacion completa de agentes
  reales sobre el artefacto ni a un smoke LLM post-upstream.
- E2E post-upstream previo al pack: simulado 1/1 y web 4/4. No se repitieron
  build, pack, typecheck ni la bateria de 8533 tests al retomar: se conservaron
  las evidencias del checkpoint y se verifico el artefacto resultante.
- Matriz adversarial Docker/FUSE/userns omitida: requiere pull/apt/red sin permiso.
- Instalacion, backup de estado y verificacion posterior en produccion pendientes
  del usuario. No se ejecutaron apply, sudo, restart de produccion ni push.
