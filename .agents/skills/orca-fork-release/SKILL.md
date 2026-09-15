---
name: orca-fork-release
description: >
  Use this skill when preparing a release of the kukapu/orca fork, integrating an
  official stable Orca version, resolving upstream merge conflicts, creating a
  kukapu version, or recovering an incomplete release and its provenance.
  Triggers include "ha salido la .203", "mergear upstream", "preparar la
  203-kukapu", "hacer una release" and "falta el manifiesto de la release".
  Covers source reconciliation, verification, packaging and authorized delivery;
  installing an already prepared server release uses orca-server-upgrade.
---

# Releases del fork Orca

Preparar una entrega reproducible desde un **tag estable exacto** de `stablyai/orca`,
conservando los cambios de `kukapu/orca`. Retomar la primera etapa incompleta;
no repetir builds cuyos inputs y evidencia siguen siendo validos.

## Antes de empezar

1. Leer `AGENTS.md`, `docs/uso/README.md` y el contrato completo
   `docs/reference/upstream-sync-automation.md` desde la raiz del checkout asignado.
   El contrato es la autoridad para comandos, marcadores y publicacion; esta skill
   organiza su ejecucion, no mantiene una segunda implementacion.
2. Aclarar por el pedido el alcance: integrar, preparar artefactos, publicar codigo,
   crear draft o instalar. Preparar no autoriza push, release publica ni instalacion.
   Commits y publicaciones requieren autorizacion; conservar hooks normales.
3. Descubrir host, runtime, workspace y trabajos existentes con la CLI instalada
   y su `--help`. No fijar IDs ni rutas de un informe antiguo como si fueran actuales.
   No lanzar agentes adicionales salvo peticion del usuario o instrucciones aplicables.
4. Usar Git, Node y pnpm ya disponibles y compatibles con el candidato, `gh` con
   repositorio explicito y un entorno aislado para pruebas. Revisar scripts antes
   de instalar dependencias o construir: `build:cli` puede instalar un CLI global.
5. Crear una lista de tareas y un informe por release a partir de
   [references/release-evidence.md](references/release-evidence.md). Guardar solo
   evidencia sanitizada en `docs/releases/`; logs y artefactos en almacenamiento
   privado persistente fuera del indice. Un archivo en `/tmp` no es evidencia durable.

## Flujo y puntos de control

### 1. Inventario y fuente

- Consultar status, HEAD, rama, remotos y operaciones pendientes. Preservar WIP.
  Trabajar solo en el checkout asignado; no cambiar de rama en el principal para
  preparar la release ni editar otros worktrees. Si hace falta un workspace de
  preparacion, establecerlo y asignar alli la ejecucion antes de integrar.
  Excepcion manual: si el usuario pide expresamente preparar aqui y dejar el
  resultado en `main-kukapu`, registrar esa ventana de mantenimiento, conservar
  los cambios conocidos y usar una rama fuente temporal en este mismo checkout;
  al cerrar los gates devolver `main-kukapu` mediante fast-forward al puente.
- Consultar releases oficiales estables, releases/drafts del fork, preparaciones
  y ejecuciones del host propietario. Un inventario incompleto no prueba ausencia
  de trabajo; no duplicar preparaciones `preparing`, `blocked` o ya preparadas.
- Reutilizar `config/scripts/upstream-release-precheck.mjs` cuando exista una
  automatizacion valida; leer sus opciones actuales. El precheck es de solo lectura,
  no un lock. Para una peticion manual repetir los mismos controles de inventario.
- Si falta procedencia o metadata, seguir
  [references/reconcile-release.md](references/reconcile-release.md).
- Fijar tag/OID oficial objetivo, sourceTag/sourceCommit anterior, ultima publicacion
  `LAST_P` y punta publicada `F`. Verificar objetos locales/remotos, tags peeled,
  padres y arboles con fetch de refs nombradas. Una anotacion del tag no es un gate.
- Revisar commits y diff `LAST_P..F` y trabajo local inedito. Clasificar dependencias
  y portar explicitamente cambios propios posteriores; desconocidos bloquean.

**Salida:** fuente verificable, trabajo previo reconciliado y objetivo sin colision.

### 2. Reserva e integracion

- Registrar el claim `preparing` en el comentario del workspace propietario,
  conservando debajo su evidencia. Releer competidores; gana el claim mas antiguo
  segun el contrato. No usar el comentario del principal como reserva de otra tarea.
- Crear candidato desde **sourceTag/C**, nunca desde el puente de publicacion `P`.
  Portar los commits propios revisados mediante cherry-pick normal antes del merge.
  Incluir tambien las mejoras de este procedimiento si son posteriores a la fuente.
- Integrar el OID verificado del tag oficial mediante merge normal. No integrar
  `upstream/main`, rebase ni aplicar ours/theirs masivo para resolver codigo.
- Revisar el delta upstream y fork, los conflictos y los solapamientos sin conflicto.
  Para cada conflicto anotar intencion de ambos lados, solucion y regresion cubierta.
  Buscar implementaciones existentes antes de conservar dos caminos equivalentes.
- Revisar contratos afectados: SSH y autoridad del host, folder workspaces,
  compatibilidad wire con clientes antiguos, Windows/WSL, Git 2.25 y proveedores Git.
  Leer sus referencias en `AGENTS.md`. UI sigue STYLEGUIDE y validacion Electron.
- Elegir `<oficial>-kukapu.N` sin colision con tags o drafts. Leer la configuracion
  de version efectiva: comprobar ASAR/CLI al empaquetar; `package.json` por si solo
  no demuestra ni version instalada ni version del artefacto.

**Salida:** candidato integrado y decisiones de preservacion documentadas.

### 3. Verificacion de fuente

- Revisar dependencias y scripts antes de `pnpm install --frozen-lockfile`; no
  normalizar lockfiles ni instalar globalmente. Usar HOME/XDG/temporales privados,
  `CI=1`, y lanzar tests/apps en segundo plano con `ORCA_BACKGROUND_LAUNCH=1`.
- Ejecutar `pnpm tc`, `pnpm test` con suites pertinentes del delta y contratos del
  fork, y `pnpm run check:code-quality:changed` con base explicita usando la interfaz
  vigente del script. Registrar comando, base, exit code y cobertura, no solo "verde".
- Incluir E2E/smokes que cubran riesgos reales. Electron: skill versionada `electron`
  y Playwright CDP, renderers ocultos. Si no esta cargada, descubrirla mediante la
  CLI instalada. Pruebas de foco/ventanas visibles solo en display aislado/CI.
- Cloud usa PostgreSQL desechable cuando lo exija el delta. No DB compartida,
  smoke LLM real, Docker pull, apt o sudo sin autorizacion. Un gate imposible se
  registra como bloqueo; skips no son pases.
- Maximo 2-3 rondas razonadas de fixes minimos antes de informar un bloqueo.
  No desactivar lint, elevar max-lines ni saltar hooks para cerrar una release.
- Con autorizacion, crear commit fuente `C` antes del build, limpio y solo con
  cambios revisados. Gates deben corresponder a `C`; si hooks cambian inputs,
  repetir los afectados. Registrar OID, tree y hashes de inputs.

**Salida:** fuente exacta C verificada; todavia no es `prepared`.

### 4. Artefactos

- Alcance inicial: Linux x64 AppImage/deb; otras plataformas necesitan inventario
  y runner apropiado. Inspeccionar scripts/config del candidato, no copiar a ciegas
  comandos de una entrega antigua.
- Reutilizar flujo node-direct de la referencia de entrega enlazada en el contrato,
  sin `install-dev-cli.mjs`. Build production, sin flags E2E, pack `--publish never`.
  No omitir fases nativas/relay/web requeridas por la revision actual.
- Verificar glibc <= 2.31 de binarios Linux, version ASAR/CLI, ausencia de secretos,
  scratch y estado de prueba; comparar size/SHA-256 y metadata de actualizacion.
- Smoke del artefacto real en aislamiento: servidor ready, PTY round-trip,
  clientes/reconexion, shutdown y coexistencia con version anterior. Registrar
  exactamente que cliente se probo: RPC/web no demuestra escritorio real.
- Con TODOS los gates y artefactos verificados, registrar `prepared` con C/tag,
  OID oficial, hashes y evidencia. Si cambia un input, invalidar solo las etapas
  dependientes; si hay fallo conservar artefactos y registrar `blocked`.

**Salida:** entrega preparada, con backups/rollback planificados; no instalada.

### 5. Publicacion autorizada

Seguir literalmente el paso 9 del contrato para el puente y la entrega:

1. Reconsultar `origin/main-kukapu`; debe seguir en F. Avance concurrente bloquea.
2. Desde C limpio, puente `git merge -s ours` SOLO para conectar historial.
   Exigir padres de P exactamente `C F`, y `tree(P)=tree(C)` antes/despues de hooks.
   Nunca usar esta estrategia para integrar codigo ni crear el puente antes de gates.
3. Tag `v<oficial>-kukapu.N` apunta a C, **no P**. Publicar sin force a
   `origin/main-kukapu` y el tag; verificar OIDs remotos. No publicar rama temporal.
4. Crear/reutilizar draft de `kukapu/orca`, sin sobrescribir assets/tags. Subir
   artefactos verificados y `orca-release-provenance.json` con el esquema actual de
   `config/scripts/upstream-release-provenance.mjs`; usar la plantilla de evidencia.
5. Validar bytes originales, size/digest del manifiesto y metadata remota de cada
   artefacto mediante el validador existente. `published` requiere codigo, tag,
   draft/assets y procedencia comprobados. En este contrato no significa release
   publica ni instalada. Si falla upload, retomar upload; no reconstruir C.
6. Mantener evidencia recuperable sin el workspace temporal. No borrar worktrees,
   sesiones ni ramas automaticamente. No modificar el bundle del precheck para
   hacerlo pasar; verificar recuperacion de la fuente por su manifiesto durable.

### 6. Entrega al usuario

Informar: oficial integrada, version fork, C/P/tag, conflictos resueltos, gates y
limites, artefactos/hashes, codigo publicado, draft y estado de instalacion.
Usar la tabla de la plantilla y fechar el informe.

Instalacion es una tarea separada autorizada, con destino y ventana segura,
backup consistente, rollback y comprobacion posterior de version activa/salud.
Para servidor usar `orca-server-upgrade` y el procedimiento vigente. No reiniciar
el servicio que aloja este trabajo desde su propio agente.

## Ejemplos de uso

- "Ha salido .203, prepara la kukapu": inventariar, integrar tag estable y
  preparar artefactos; comprobar alcance autorizado antes de commits/publicacion.
- "La .200 funciona pero falta su manifiesto": reconciliar fuente y decision
  operativa con la referencia; no inventar checks ni publicar un manifiesto vacio.
- "Se corto la subida del draft": verificar C/P/tag y artefactos conservados,
  subir solo lo pendiente y comprobar procedencia remota, sin repetir build.

## Fallos que no hay que repetir

- Un merge desde P puede omitir cambios upstream que Git cree ya integrados.
- CLI sin automatizacion o contacto perdido: comprobar host/runtime, nunca declarar
  que el trabajo termino. Veredictos de proceso: `live` / `unverifiable` / `exited`.
- Version en ejecucion aceptada por el usuario prueba aceptacion operativa, no
  correspondencia criptografica con C ni gates historicos.
- Nuevos docs/skills en el principal son cambios propios que hay que preservar
  y portar; no desaparecen por partir del tag fuente anterior.
- En este entorno se ha observado que `pnpm exec` sincroniza dependencias y ejecuta
  postinstall antes del comando. Para checks documentales usar directamente el
  binario ya instalado; revisar efectos de pnpm antes de los gates de una release.
