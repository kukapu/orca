# Inputs de la reconstruccion exacta 1.4.198

Base: `v1.4.198`, commit `e0826956fcfc532f5a1e55b5e081f2e57e553c43`.
`package.json` y `pnpm-workspace.yaml` coinciden con el tag.

## Lock y excepcion propia

`pnpm-lock.yaml` se corrigio manualmente, sin resolver ni normalizar dependencias.
El diff contra el tag contiene solo tres sustituciones del hash de `node-pty@1.1.0`
(patchedDependencies, importer y snapshot):

- Upstream: `7cc9d45f3d2c38f142490d0805e75db55f0eef5174ad41c4b52abc5fbe079ad1`.
- Fork: `6cdcbddd3085ae558427249bf1e033e1bb1e84af218e17bae2b89286c651387c`,
  confirmado por SHA-256 del parche configurado en `pnpm-workspace.yaml`.

Se conserva la correccion Linux de [cfset y glibc](../fixes/node-pty-glibc-2-42-cfset.md).
No se uso el lock de F5fc ni se incorporaron sus cambios MSYS.
Se retiro el drift de SDK 0.123.0, las entradas opcionales de binarios Claude,
los cambios de resolucion YAML/KaTeX/ws, las claves peer de express-rate-limit
y la metadata de deprecacion de xmldom ajenos al tag.
Esto conserva tambien las versiones coexistentes del tag: YAML 2.8.4/2.9.0,
KaTeX 0.16.45/0.16.47 y ws 8.21.0/8.21.3; no es un downgrade global.

## Guia y verificaciones

La guia monolitica conserva Pi `--effort` → `--thinking` y explicita los IDs
OpenCode anidados y la falta de `--effort` al lanzamiento; ver
[OpenCode worker launch models](opencode-worker-launch-models.md).
El bundle se regenero solo con el generador existente, bajo `run-clean.sh`.
Pasaron `verify:bundled-skill-guides`, `verify:skill-bundle-manifest` y
`git diff --check`; las proyecciones `skills/` y manifiestos no cambiaron.

No se ejecutaron install, tests, typecheck, builds ni apps/LLM en esta tarea.
La preparacion de dependencias y los tests quedan al coordinador, incluidos
`src/main/runtime/rpc/methods/orchestration-worker-launch-preferences.test.ts`
y los gates Linux de glibc/PTY documentados en
[Linux glibc compatibility](../reference/linux-glibc-compatibility.md).
La comprobacion del hash no certifica un binario compilado ni su compatibilidad.
