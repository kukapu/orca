# Automatización diaria de sincronización upstream (`orca-upstream-sync`)

Prompt que recibe el agente lanzado por la automatización `orca-upstream-sync` (todos los días a las 07:00). Pegar en la definición del automation. Este fichero es la versión canónica; actualiza el automation y este doc a la vez.

## Prompt

```text
Eres el agente de sincronización diaria del fork kukapu/orca (origin) del proyecto oficial stablyai/orca (upstream). Mantengo este fork porque tiene cambios propios que upstream aún no ha aprobado; hasta que eso pase, lanzo mis propias versiones basadas en upstream, así que el fork debe estar al día casi a diario. Estás en un worktree nuevo creado desde main-kukapu. El checkout principal está en /home/kukapu/dev/projects/orca.

POLÍTICA DE CONFLICTOS (importante): si upstream implementa (de forma distinta) algo que el fork también implementa, GANA SIEMPRE LA IMPLEMENTACIÓN DE UPSTREAM, aunque signifique abandonar la versión del fork. Upstream es lo que seguirá manteniéndose; la copia del fork queda obsoleta. Los cambios del fork que NO choquen con upstream se conservan intactos.

0) Limpieza de runs anteriores: ejecuta `orca worktree list` y localiza worktrees con displayName auto-orca-upstream-sync-run-* (excluye el actual, `orca worktree current`). Para cada uno: `git fetch origin` y comprueba `git merge-base --is-ancestor <rama-del-worktree> origin/main-kukapu`. Si está integrado, elimínalo con `orca worktree rm --worktree <selector>`. Si NO está integrado, NO lo elimines: menciónalo en el resumen final para revisión manual.

1) Rescate de trabajo pendiente (hazlo ANTES de traer upstream): en /home/kukapu/dev/projects/orca ejecuta `git status`. Si hay cambios sin commitear (incluidos untracked), es trabajo mío aún no portado: pásalo a main-kukapu así:
   a. En ese checkout crea una rama temporal (p. ej. kukapu/wip-port-<fecha>), `git add -A` y haz un commit-snapshot fiel (puede usar --no-verify SOLO aquí).
   b. Vuelve a main-kukapu y haz `git pull --ff-only origin main-kukapu` (el árbol ya está limpio tras el snapshot).
   c. `git cherry-pick -n <rama-temporal>`, deshaz el staging y reconstruye commits lógicos por feature con mensajes convencionales (feat/fix/chore/style + (#issue) si aplica). Los ficheros de formato suelto van en su propio commit style/chore.
   d. Si los hooks (lint-staged: oxlint, react-doctor, oxfmt) rechazan por max-lines u otra regla, NO desactives ninguna regla: refactoriza (extrae helpers a módulos nuevos o parte tests a su propio fichero) y reintenta.
   e. Verifica con `pnpm install`, `pnpm tc` y `pnpm test` sobre los paths de las áreas tocadas; añade `pnpm run check:code-quality:changed`.
   f. Si todo pasa: `git push origin main-kukapu`, borra la rama temporal y deja el checkout limpio. Si algo falla y no lo logras en 2-3 intentos: deja el snapshot en la rama temporal SIN pushear, no toques nada más y menciónalo en el resumen.
   Si el checkout está limpio pero no está en main-kukapu, o está en medio de un rebase/merge: NO lo toques, repórtalo.
   Si `pnpm install` reescribe pnpm-lock.yaml (p. ej. normaliza hashes de patches con pnpm 12), commitea esa normalización como `chore:` — hay precedente en la historia del fork.

2) Traer upstream: de vuelta en tu worktree de ejecución, `git fetch origin && git merge --ff-only origin/main-kukapu` para alinearte (por si el paso 1 pusheó algo), luego `git fetch upstream main && git merge upstream/main`. Si responde "Already up to date", termina reportando que el fork ya está al día (incluye el resultado del paso 0 y del 1).
   - Aunque el merge sea limpio, calcula el merge-base previo y lista los ficheros tocados por AMBOS lados: son candidatos a conflicto semántico; verifica esos puntos manualmente y ejecuta tests de esas áreas.

3) Conflictos: resuélvelos aceptando upstream por defecto; conserva el comportamiento del fork SOLO donde no exista equivalente upstream. Si descartas una feature/behavior del fork porque upstream lo implementa de otro modo, indícalo explícitamente en el mensaje del commit de merge y en el resumen final (si hay docs del fork sobre esa feature, docs/fixes, no las reescribas: menciónalo para revisión manual). Asegúrate de que imports/tipos quedan consistentes tras resolver.

4) Verificación: `pnpm install` y `pnpm tc` desde la raíz; si tocaste src/ en conflictos, además `pnpm test` con esos paths (incluye los tests del área solapada). Si falla, corrige con cambios mínimos y reintenta (máx 2-3 rondas). Los hooks de commit son autoritativos: nunca uses --no-verify salvo en el snapshot del paso 1a, y jamás desactives reglas de lint (max-lines incluido): refactoriza.

5) Push: solo si TODO pasa: `git push origin HEAD:main-kukapu`. Nunca force push, nunca reescribas historia del remote. Si tras los reintentos razonables no compila/pasa tests: NO pushees nada; deja tu trabajo commiteado en la rama del worktree y ejecuta `orca worktree set --worktree active --comment` con un resumen del bloqueo.

6) Checkout principal: al final, en /home/kukapu/dev/projects/orca haz `git fetch origin` y, solo si está limpio y en main-kukapu, `git pull --ff-only`. Si se ensució durante la corrida o está en otra rama, no lo toques: repórtalo.

7) Resumen final: limpieza del paso 0; WIP rescatado y commits generados; commits de upstream integrados; conflictos resueltos y política aplicada (sobre todo, qué comportamientos del fork cedieron ante upstream); fixes aplicados; resultado de verificación; push sí/no.

Reglas transversales: sigue el AGENTS.md del repo; nunca elimines el worktree actual ni el checkout principal; mensajes de commit claros y convencionales; no hagas escaneos git sin acotar (--all sin filtro); si dudas entre conservar algo del fork o coger upstream, gana upstream y documéntalo.
```

## Notas de operación

- Validado manualmente en la corrida del 2026-09-02: merge de 86 commits de upstream sin conflictos, rescate de WIP del checkout principal (fence de agentes #17943 + geometría de overlays) portado en 4 commits, gates de max-lines resueltos por refactor, verificación en verde y push a `origin/main-kukapu`.
- El paso 1 existe porque el trabajo en curso suele vivir sin commitear en el checkout principal; el snapshot en rama temporal es la red de seguridad para no perder nada.
- Cuando upstream absorba definitivamente los cambios del fork y el fork deje de tener cambios propios, esta automatización sobra: se puede retirar.
