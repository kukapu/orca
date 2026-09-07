# Smoke artefacto 1.4.197-kukapu.2 — 2026-09-07

QA local sin LLM del candidato `dist/release-1.4.197-kukapu.2-20260907/`
(AppImage + linux-unpacked del mismo pack de Core 10:19Z). Sin recompilar,
sin empaquetar, sin E2E, sin instalar. HEAD `42ab555177`.

## Artefacto

SHA-256 verificados contra el informe de entrega:

- `orca-linux.AppImage` (195046613 B):
  `4c399be795bc6703837b2c6b316c8bbbce97806747a3333c0bfa04f2416a8483`
- `orca-ide_1.4.197-kukapu.2_amd64.deb` (165434128 B):
  `ef7b6602c836f1a2d6ab1b0dbab20e395171c7629d385650bf8702a6d7501c67`

## Launcher (script real, sin ELECTRON_RUN_AS_NODE externo)

`resources/bin/orca-ide` fija `ELECTRON_RUN_AS_NODE=1` internamente y hace
`exec` al binario con `app.asar.unpacked/out/cli/index.js`; ejecutar el
script ES el path real del CLI. Env allowlist limpio (sin `ORCA_*`
heredados, sin `DISPLAY`), HOME privado fresco, exits capturados del proceso:

- unpacked `--help` exit 0, contiene `Usage: orca`
- unpacked `--version` exit 0, exactamente `1.4.197-kukapu.2`
- AppImage (`APPIMAGE_EXTRACT_AND_RUN=1`) `--help` exit 0 con `Usage: orca`,
  `--version` exit 0 con `1.4.197-kukapu.2`

## Serve propio aislado

`serve --port <libre> --no-pairing --json` bajo Xvfb propio `:100`
(los probes sin `DISPLAY` en el env del hijo fallaron intentando obtener
`:99`; otro fallo por omitir `XAUTHORITY`. Ninguno cuenta como aprobado). HOME `mkdtemp`
nuevo por corrida, eliminado al final.

- ready visto; `runtimeId` distinto de produccion
  (`3aae6f99-a1d9-4c8f-87e9-579518628130`)
- puerto ligado == puerto pedido (no 6768)
- `status --json` con el mismo HOME (solo-lectura, metadata del userData
  privado): exit 0, `app.running` true, `runtime.reachable` true,
  `runtimeId` identico al ready, `appVersion` exactamente `1.4.197-kukapu.2`
- SIGTERM → exit 0; sin procesos propios restantes; HOME eliminado
- estado solo bajo el HOME privado (`.config`, `.local`, `.cache`, `.orca`)

Nota: el `pid` de `status` no coincide con el pid del launcher
(`exec` + forks internos); la identidad se prueba por `runtimeId`, no por pid.

Contrato capturado: el ready de `serve --json` no trae `appVersion` ni
`dataDir` (claves: type, schemaVersion, runtimeId, endpoint,
boundEndpoint, advertisedEndpoint, managedWslCliReconciliation, pairing).
La version del proceso vivo se prueba via `status`; el `dataDir` por
aislamiento del HOME. El listado de directorios de QA no probaba por si solo
la identidad del metadata; la comprobacion del coordinador siguiente cierra
esa carencia y comprueba explicitamente que el puerto se libera.

## Aceptacion Independiente Del Coordinador

Ejecutada sobre el AppImage fechado real, no sobre `out/` ni solo linux-unpacked:

```bash
ORCA_BACKGROUND_LAUNCH=1 xvfb-run --auto-servernum --server-num=100 \
  node /tmp/opencode/artifact-acceptance-1972.mjs
```

Exit 0, 2026-09-07 antes de las 10:44 UTC. Aserciones de la corrida:

- AppImage `--help`: exit 0, `Usage: orca <command>`; `--version`: exit 0,
  salida completa, tras trim, exactamente `1.4.197-kukapu.2`.
- Entorno allowlist, `APPIMAGE_EXTRACT_AND_RUN=1`, sin `ELECTRON_RUN_AS_NODE`
  externo, sin ORCA heredadas. Xvfb `:100` con su `XAUTHORITY`, HOME/TMPDIR/XDG
  nuevos bajo `/tmp/opencode/artifact-acceptance-1972-6BKcQl`.
- Runtime `10d69f91-1ba8-4fb4-a1d7-ad9f16d60edc`, distinto de produccion;
  `status`: `ready`, reachable, `appVersion=1.4.197-kukapu.2`.
- Metadata en `HOME/.config/orca/orca-runtime.json`: runtimeId igual al ready y
  a status, PID igual al proceso de la aplicacion reportado por status. Solo se
  compararon en memoria los campos permitidos; no se imprimio authToken.
- Puerto pedido y ligado `35719`; `GET /` HTTP 200.
- SIGTERM al PID propio identificado por metadata; AppImage exit 0, runtime PID
  `ESRCH`, puerto `ECONNREFUSED`, HOME eliminado. Cleanup en `finally`.
- Evidencia sanitizada: `/tmp/opencode/artifact-acceptance-1972.json`.
  Tras la corrida, solo queda el Xvfb `:99` preexistente de produccion.

Los probes iniciales de QA con `env -u DISPLAY` heredaban ORCA y ocultaban el
exit con pipelines: quedan invalidados. No se infiere exito de su codigo de
shell. El verificador final usa aserciones y devuelve error si un gate falla.

## Limites

- Produccion sigue `ready` en `.1` con el mismo runtimeId y los servicios con
  PIDs/fechas originales comprobados. Sin instalacion ni reinicio de produccion.
- Sin secretos en evidencia: solo campos (`runtimeId`≠prod, version,
  puertos, exits); `pairing` nunca impreso.
- No declara instalacion. Scripts en `/tmp/opencode`
  (`artifact-launcher-check.mjs`, `artifact-serve-smoke.mjs`); resumen
  sanitizado en `/tmp/opencode/smoke-evidence/summary.json`.
