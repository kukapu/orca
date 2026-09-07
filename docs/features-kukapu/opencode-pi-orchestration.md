# Orquestacion OpenCode y Pi en Orca Remote Server

- Fecha del diagnostico: 2026-09-06.
- Estado: primer bloque de fiabilidad implementado y verificado; resto del plan pendiente.
- Auditoria inicial: `main-kukapu`, commit `66d9ee06d6`.
- Base de implementacion: merge `ee2e5da315`, con `origin/main-kukapu` en `63a3944846` y `upstream/main` en `5ae76afda6`.
- Release objetivo: `1.4.197-kukapu.2`, pendiente de implementar, verificar, compilar e instalar.
- Alcance actual: sincronizacion del checkout y cambios de fiabilidad con pruebas simuladas; no instalar ni reiniciar el servidor en produccion.

## Objetivo

Los flujos de recuperacion deben considerar el incidente de
[cuota agotada y reanudacion manual concurrente](./orchestration-quota-manual-resume.md):
confirmar salida de un intento no evita que el usuario reanude la misma tarea con
otra identidad. Reconciliar ownership antes de crear reemplazos.

Permitir que un coordinador, inicialmente GPT-6 Astra, gestione proyectos de largo
horizonte y lance workers OpenCode y Pi en paralelo o secuencialmente, eligiendo
modelo y opciones compatibles por tarea. Debe poder observar sus resultados,
resolver preguntas, verificar entregables y recuperar el trabajo sin duplicar
agentes ni perder contexto cuando un cliente se desconecte.

No buscamos otro sistema de agentes. Extendemos Run, Task, Dispatch, workers,
sesiones, hooks y lectores existentes en Orca.

## Entorno confirmado

El usuario ejecuta **Orca Remote Server en un servidor** y se conecta mediante la
aplicacion Orca desde varios ordenadores, normalmente su sobremesa. No es el caso
de un Orca de escritorio que controla el servidor como un simple workspace SSH.

```text
Cliente Orca A / Cliente Orca B
              |
              v
Servidor Orca: runtime y estado de orquestacion
              |
              +-- Coordinador
              +-- Workers OpenCode / Pi
              +-- Repositorios, carpetas, sesiones y artefactos
```

- El servidor es propietario de los procesos, binarios, credenciales, configuracion y archivos de los agentes que ejecuta.
- El coordinador y el Run deben residir en el servidor para no depender de una aplicacion cliente abierta.
- Cerrar o cambiar de cliente no debe lanzar reemplazos ni reasignar automaticamente el coordinador.
- Varios clientes pueden observar el mismo trabajo; no deben convertirse implicitamente en coordinadores concurrentes del mismo Run.
- Versiones distintas de cliente y servidor son un caso normal, no una excepcion.
- Un reinicio del runtime requiere validacion especifica: no prometer supervivencia de procesos frente a una parada que elimine todo el cgroup.
- SSH directo, WSL y otros hosts siguen siendo contratos que no debemos romper, pero no son la ruta principal de esta iniciativa.

Referencias: [Remote Orca Servers](../site/content/docs/remote-servers.mdx),
[frontera SSH](../reference/ssh-execution-boundary.md),
[operacion de orcad](../reference/orcad-operations.md) y
[compatibilidad remota](../reference/remote-wire-compatibility.md).

## Base y evidencia

La auditoria corresponde al checkout indicado, no a una comprobacion del build
activo. El [registro de la release anterior](../releases/v1.4.197-kukapu.1.md)
documenta `1.4.197-kukapu.1` instalada en `olares-one` el 2026-09-04; esto es
evidencia historica, no una consulta actual al servidor.

La discrepancia inicial entre checkout y origin se resolvio el 2026-09-06:
fast-forward de 220 commits hasta `63a3944846` y merge de otros 20 commits de
upstream hasta `5ae76afda6`. El merge `ee2e5da315` contiene ambos extremos sin
conflictos; el unico solapamiento directo entre esas ramas era el catalogo ingles,
con claves distintas. Se preservaron los cambios documentales pendientes mediante
un stash identificado y se restauraron tras el merge. No se hizo push ni despliegue.

Verificaciones realizadas durante la auditoria:

- OpenCode instalado: `1.18.29`, comprobado con `--version`, ayuda TUI y `run --help`.
- Pi instalado: `0.85.0`, comprobado con `--version` y `--help`.
- No se inspeccionaron credenciales ni se lanzaron sesiones reales o llamadas LLM de prueba.
- Se ejecutaron seis suites focalizadas: 101 tests aprobados, cero fallos y sin warnings del runner.
- No se ejecutaron E2E de agentes reales, pruebas multicliente ni validacion de la instalacion activa.
- La version de Pi no identifica por si sola el commit ni los cambios de su fork local.

Comando de las suites ejecutadas:

```bash
TMPDIR=/tmp/opencode pnpm exec vitest run --config config/vitest.config.ts \
  src/main/runtime/rpc/methods/orchestration-worker-launch-preferences.test.ts \
  src/shared/tui-agent-startup-session-options.test.ts \
  src/shared/agent-session-option-catalog.test.ts \
  src/main/pi/agent-status-extension-source.test.ts \
  src/main/runtime/orchestration/worker-start-unobserved-prompt-settlement.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-start-prompt-contract.test.ts
```

Estas pruebas cubren contratos actuales; no demuestran que las carencias descritas
a continuacion esten corregidas. Se uso Vitest directamente para evitar un rebuild
de modulos nativos mientras Orca estaba en uso.

## Capacidades existentes

| Area                                          | OpenCode                                      | Pi                                                 |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| Worker gestionado por terminal                | Si                                            | Si                                                 |
| Modelo por `worker-start --model`             | Si, `provider/model`, incluidos IDs anidados  | Si, `provider/model`                               |
| `worker-start --effort`                       | Rechazado deliberadamente                     | Se traduce a `--thinking`                          |
| Esfuerzo en el CLI instalado                  | `run --variant`; no anunciado en la ayuda TUI | `--thinking off/minimal/low/medium/high/xhigh/max` |
| Hooks de actividad e identidad de sesion      | Si                                            | Si, con extensiones                                |
| Resume de panes                               | Por session ID                                | Por archivo de sesion                              |
| Historico en AI Vault                         | Si                                            | Si                                                 |
| Transcript estructurado en `worker-read`      | No; puede recurrir al terminal                | No; puede recurrir al terminal                     |
| Confirmacion del modelo activo al coordinador | No                                            | No                                                 |

La seleccion de modelo no certifica disponibilidad, autenticacion ni compatibilidad
de todos los niveles de esfuerzo. `--effort` exige `--model`; ninguna de esas
preferencias se puede aplicar al reutilizar un terminal mediante `--terminal`.

La orquestacion ya dispone de Tasks con dependencias, Dispatches por intento,
mensajes durables con ACK, preguntas, receipts recuperables y limpieza controlada
de terminales. El coordinador sigue decidiendo cuando lanzar las tareas listas.
No existe en esta superficie un scheduler autonomo de DAG ni `worker-resume`.

La entrada recomendada inicialmente es la CLI de Orca sobre su RPC existente.
No se identifico un SDK publico ni un servidor MCP de orquestacion en la auditoria.
`orchestration send` entrega correo durable; no equivale a interrumpir o inyectar
inmediatamente instrucciones al modelo.

Referencias de codigo:

- [Contrato CLI de workers](../../src/cli/specs/orchestration-worker-specs.ts).
- [Preferencias de lanzamiento](../../src/main/runtime/rpc/methods/orchestration-worker-launch-preferences.ts).
- [Catalogo Pi](../../src/shared/agent-session-option-catalog-pi.ts).
- [Lector de workers](../../src/main/runtime/orchestration/worker-transcript-read.ts).
- [Guia de orquestacion](../../skill-guides/orchestration.md).

## Hallazgos auditados

La tabla conserva el diagnostico inicial. PI-01, PI-02 y la proteccion de arranque
de ORCH-01 ya tienen regresiones reproducidas y cambios verificados sobre la base
sincronizada; sus limites se detallan en Seguimiento. El resto sigue pendiente de
revalidacion e implementacion. No se han reproducido fallos en produccion.

| ID      | Prioridad | Evidencia y efecto                                                                                                                                                                             | Direccion propuesta                                                                                               |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ORCH-01 | Alta      | `agent_prompt_stalled` puede dejar un worker trabajando aunque el arranque figure como failed; los tests permiten su settlement posterior. Reintentar sin reconciliar puede duplicar editores. | Separar incertidumbre de entrega, resultado de tarea y evidencia de proceso antes de reemplazar.                  |
| OUT-01  | Alta      | `worker-transcript-read.ts` depende de los agentes soportados por native chat; excluye OpenCode y Pi.                                                                                          | Reutilizar parsers de AI Vault para lectura de la sesion exacta, sin exigir una nueva UI de chat.                 |
| PI-01   | Alta      | `agent-status-extension-source.ts` conserva un unico evento pendiente; `agent_end` puede reemplazar `message_end` o el prompt, que contienen datos no incluidos en el final.                   | Conservar informacion acumulada o eventos necesarios sin bloquear Pi ni crear una cola ilimitada.                 |
| PI-02   | Alta      | `tui-agent-config.ts` entrega el prompt inicial Pi por argv sin separador `--`, aunque el CLI lo soporta.                                                                                      | Probar y corregir mensajes que comienzan con opciones, manteniendo quoting multiplataforma.                       |
| OBS-01  | Alta      | `launch.effective` se construye desde la seleccion aplicada por Orca, no desde observacion del proveedor.                                                                                      | Anadir evidencia opcional de modelo/thinking observado sin reinterpretar campos ya publicados.                    |
| PI-03   | Media     | SSH instala estado Pi, pero no prefill; `wsl-hook-relay-deps.ts` solo envia el plugin OpenCode.                                                                                                | Completar capacidades por host y diagnosticar degradacion; ruta secundaria respecto al servidor remoto principal. |
| PI-04   | Media     | Discovery de AI Vault no contempla `PI_CODING_AGENT_SESSION_DIR`; resume de Vault usa ID donde el pane conserva la ruta.                                                                       | Unificar procedencia y resume por sesion exacta con pruebas de directorios personalizados.                        |
| CFG-01  | Media     | `WorkerStartParams` no expone perfil, agente interno OpenCode, politica de herramientas/permisos ni checkpoint.                                                                                | Ampliar el contrato existente con opciones validadas y negociadas, no otro spawn.                                 |
| OC-01   | Media     | Discovery nativo descarta el cwd solicitado; hay parsers OpenCode divergentes; resume concatena el selector sin proteger todos los overrides.                                                  | Probar coherencia por proyecto, validacion de IDs y composicion del resume.                                       |
| OC-02   | Media     | Generacion headless puede heredar un overlay OpenCode sin source y la identidad de un pane ancestral.                                                                                          | Probar aislamiento del entorno auxiliar antes de cambiarlo; no confundir este recorrido con workers TUI.          |

Puntos de entrada adicionales:

- [Settlement con prompt no observado](../../src/main/runtime/orchestration/worker-start-unobserved-prompt-settlement.test.ts).
- [Cola de hooks Pi](../../src/main/pi/agent-status-extension-source.ts) y [eventos Pi](../../src/main/pi/agent-status-handler-source.ts).
- [Configuracion TUI](../../src/shared/tui-agent-config.ts).
- [Plugins SSH](../../src/main/ssh/ssh-relay-session.ts) y [plugins WSL](../../src/main/agent-hooks/wsl-hook-relay-deps.ts).
- [Schema worker-start](../../src/main/runtime/rpc/methods/orchestration-worker-start-schema.ts).
- [Discovery de modelos](../../src/main/text-generation/commit-message-model-discovery.ts), [entorno headless](../../src/main/text-generation/commit-message-agent-environment.ts) y [comando de resume](../../src/shared/agent-resume-launch-command.ts).

## Decisiones de diseno

1. Mantener inicialmente workers TUI, aprovechando inspeccion e intervencion humana existentes.
2. Mantener OpenCode sin effort explicito en `worker-start` por ahora. No prometer que su configuracion heredada corresponda siempre al ultimo effort esperado.
3. Usar el thinking de Pi ya integrado y comprobar el comportamiento real de su build local antes de extender el contrato.
4. Leer resultados estructurados sin acoplar su disponibilidad a la implementacion completa de native chat.
5. Mantener un solo ciclo Run/Task/Dispatch para futuros adaptadores programaticos. Pi RPC y OpenCode server/JSON son candidatos, no migraciones ya decididas.
6. Distinguir correo al worker, nuevo prompt, interrupcion del turno y parada del proceso. `worker-stop` cierra el terminal gestionado; no es un abort de proveedor que preserve la sesion viva.
7. Usar resultados y checkpoints explicitos como memoria durable; el tail del terminal y los snapshots archivados son acotados.
8. No tratar el prompt "solo lectura" como aislamiento. Aplicar restricciones reales de herramientas cuando el proveedor las soporte y declarar los limites restantes.
9. Mantener capacidades por host, campos remotos opcionales y negociacion cuando el comportamiento lo requiera. Nunca hacer fallback silencioso al ordenador cliente.
10. Preservar `live` / `unverifiable` / `exited` como vocabulario de evidencia del proceso, separado del estado de turno y del resultado de tarea.

## Plan incremental

### Fase 0: Baseline reproducible

- [x] Reconciliar checkout, origin y sincronizacion de upstream preservando cambios pendientes; volver a auditar lo que upstream haya modificado.
- [ ] Registrar commit de partida y version realmente activa del servidor mediante inspeccion de solo lectura.
- [ ] Registrar versiones de los clientes de prueba, binarios efectivos de Pi/OpenCode y procedencia del fork Pi, sin volcar secretos.
- [ ] Preparar un runtime de prueba aislado de produccion y fixtures de agentes sin consumo LLM.

Aceptacion: el codigo bajo prueba, el servidor instalado y cada cliente estan
identificados por separado; ninguna prueba puede operar accidentalmente sobre
sesiones, configuraciones, puertos o datos de produccion.

### Fase 1: Fiabilidad del ciclo de vida

- [x] Reproducir y corregir PI-01 en el transporte fetch y PI-02 con los harnesses existentes.
- [x] Bloquear reemplazos de ORCH-01 por `--retry-of` o por reset de Task a ready; cubrir rollback, replay y persistencia.
- [ ] Completar ORCH-01: parada desde failed, settlement tardio federado y compatibilidad con receipts antiguos que perdieron el codigo del error.
- [ ] Verificar orden y limite de procesos en el fallback WSL `curl.exe` de hooks Pi.
- [ ] Exponer degradacion de hooks, prefill e identidad de sesion en el host ejecutor.
- [ ] Resolver PI-03 antes de declarar paridad con SSH directo o WSL.

Aceptacion: una congestion breve no pierde la respuesta final en la cola de hooks;
los prompts no se interpretan como flags; ninguna incertidumbre dispara por si
sola un reemplazo o una declaracion de muerte del proceso. La cola sigue siendo
best-effort y acotada, no un archivo durable de todos los turnos.

### Fase 2: Resultados y observabilidad

- [ ] Implementar OUT-01 para Pi y OpenCode reutilizando sus lectores existentes.
- [ ] Paginar por sesion exacta, con cursores, avisos de truncamiento y acceso en el servidor propietario.
- [ ] Implementar OBS-01 con modelo/thinking observado o ausencia explicita de evidencia.
- [ ] Cubrir PI-04 y los casos de resume/configuracion de OC-01; probar OC-02 de forma aislada.
- [ ] Conservar resultado y referencias a artefactos antes de liberar recursos del worker.

Aceptacion: ambos clientes pueden consultar el mismo resultado sin interpretar
repintados TUI, incluso tras liberar el terminal; una lectura parcial nunca se
presenta como transcript completo ni una seleccion solicitada como observada.

### Fase 3: Configuracion por tarea

- [ ] Definir perfiles reutilizables: investigacion, implementacion, revision y verificacion.
- [ ] Resolver por perfil agente, modelo, thinking compatible, instrucciones, herramientas/permisos y contrato de resultado.
- [ ] Distinguir proveedor Orca (`opencode`) de agente interno OpenCode; decidir el campo publico antes de implementarlo.
- [ ] Validar capacidades en el servidor y rechazar opciones no soportadas con errores explicitos.
- [ ] Asegurar que cambiar de cliente o reanudar una sesion no sobreescribe sus opciones accidentalmente.

Aceptacion: dos workers simultaneos usan configuraciones distintas y trazables sin
modificar defaults globales ni el entorno de otros agentes. Los campos nuevos no
rompen clientes o servidores anteriores.

### Fase 4: Coordinacion de largo horizonte

- [ ] Definir concurrencia maxima, intentos y presupuestos de tiempo; consumo/coste solo cuando sea observable, sin inventar estimaciones autoritativas.
- [ ] Establecer ownership de archivos o aislamiento de workspaces para editores paralelos, incluyendo carpetas sin Git.
- [ ] Pasar explicitamente resultados de dependencias y guardar checkpoints del coordinador.
- [ ] Recuperar decisiones, Delivery/ACK y request IDs tras reinicios sin repetir efectos.
- [ ] Verificar resultados mediante checks y revision independiente, no solo por `worker_done`.
- [ ] Evaluar despues si Pi RPC/OpenCode server aportan control necesario que la ruta actual no puede ofrecer.

Aceptacion: un flujo paralelo seguido de una tarea dependiente puede continuar
sin clientes conectados, cambiar de cliente y recuperarse desde checkpoints sin
duplicar workers, perder preguntas ni aceptar resultados no verificados.

## Matriz de verificacion

| Prioridad      | Escenario                                                            | Evidencia requerida                                                                                              |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Principal      | Servidor remoto con workers Pi y OpenCode                            | Modelo solicitado, comando aplicado, identidad de sesion y resultado recuperable.                                |
| Principal      | Dos clientes conectados al mismo servidor                            | Observaciones coherentes; acciones respetan ownership; no hay doble dispatch implicito.                          |
| Principal      | Desconectar todos los clientes y reconectar desde otro               | Workers y coordinador continuan en el servidor; se recuperan mensajes y resultados sin duplicados.               |
| Principal      | Cliente anterior con servidor nuevo y viceversa                      | Negociacion o degradacion explicita; ninguna opcion solicitada se ignora silenciosamente.                        |
| Principal      | Prompt incierto, timeout, pregunta pendiente y respuesta RPC perdida | Recuperacion por identidades originales; sin reintentos ciegos ni ACK prematuro.                                 |
| Principal      | Reinicio controlado del runtime de prueba                            | Reconciliacion de procesos/sesiones y checkpoints; distinguir reinicio de runtime de teardown del daemon/cgroup. |
| Principal      | Paralelismo, dependencia y carpeta sin Git                           | Orden correcto, contexto explicito y politica de edicion sin suponer worktrees Git.                              |
| Principal      | Hooks lentos/desactivados, configuracion propia y transcript grande  | Degradacion explicita, cola acotada y lectura paginada sin atribucion a otra sesion.                             |
| Compatibilidad | SSH directo, WSL, Windows y macOS en rutas afectadas                 | Instalacion por host, paths/quoting correctos y ausencia de fallback local.                                      |

Por cada cambio: prueba de regresion que falle antes del fix, suite focalizada,
typecheck pertinente (`pnpm tc` o sus proyectos) y calidad de codigo de archivos
cambiados. Registrar resultados en este documento, no reutilizar los 101 tests
iniciales como evidencia de una implementacion posterior.

Para UI Electron, usar Playwright CDP y el flujo Electron del repositorio, no
computer-use. Si falta ese entorno, registrar el bloqueo en lugar de afirmar que
se ha validado la UI. Las pruebas con agentes reales y consumo de modelos se
ejecutaran como smoke acotado, despues de las pruebas simuladas.

## Release y despliegue

### Alcance recomendado para la .2

Propuesta pendiente de cerrar con el usuario; no representa trabajo terminado.
La sincronizacion y el primer bloque de fixes no completan el objetivo de
orquestacion de largo horizonte. Para una .2 avanzada recomendamos incluir:

1. Recuperacion segura de workers inciertos: parada desde failed, resultado tardio y errores sin duplicar trabajo, priorizando el servidor propietario del Run. Validar federation si se incluye como capacidad de la release; declarar sus limites si se pospone.
2. Lectura estructurada de resultados OpenCode/Pi por sesion exacta, con paginacion, truncamiento explicito y artefactos conservados antes de liberar recursos.
3. Confirmacion del modelo y thinking activos donde exista evidencia del proveedor, y diagnostico explicito cuando falten hooks o capacidades; nunca presentar una opcion solicitada como observada.
4. Pruebas reales acotadas con ambos agentes y dos clientes: desconexion de clientes, reconexion, preguntas, finalizacion, recuperacion y compatibilidad de versiones.
5. Build aislado, gate glibc, smoke del artefacto y plan de backup/rollback antes de instalar.

No hace falta introducir mas subsistemas para esa entrega. Los perfiles avanzados,
presupuestos automaticos, un scheduler mas amplio y los adaptadores Pi RPC/OpenCode
server pueden quedar para iteraciones posteriores. El effort explicito de OpenCode
TUI sigue fuera del alcance inicial. Antes de recortar cualquier fase, registrar
la exclusion y su impacto: la .2 no debe anunciar paridad ni fiabilidad no probadas.

### Checklist de entrega

Objetivo solicitado: `1.4.197-kukapu.2`. Si antes del empaquetado cambia la version
base o el alcance, confirmar la numeracion; no cambiarla silenciosamente ni fingir
que el build corresponde al tag upstream `v1.4.197`.

- [ ] Cerrar las fases incluidas en la release; registrar exclusiones y riesgos pendientes expresamente.
- [ ] Revalidar solapamientos con upstream y ejecutar checks sobre el commit final, no solo sobre el inicio de la auditoria.
- [ ] Compilar con `ORCA_LOCAL_BUILD_VERSION=1.4.197-kukapu.2` usando el runbook vigente y el gate glibc del proyecto.
- [ ] Probar el artefacto aislado de produccion, incluida conexion multicliente y agentes reales con tareas acotadas.
- [ ] Preparar backup del artefacto y de los datos necesarios, rollback y ventana de mantenimiento; comprobar el efecto del reinicio sobre agentes activos.
- [ ] Instalar solo tras revisar los resultados; no reiniciar produccion mientras el coordinador dependa de ella sin un checkpoint y un plan de recuperacion.
- [ ] Verificar version activa, salud del runtime, conexion de clientes, spawn, resultado y recuperacion; registrar evidencia real de la instalacion.
- [ ] Crear `docs/releases/v1.4.197-kukapu.2.md` y actualizar el indice con commit, base upstream, delta, artefactos, verificaciones, incidencias y estado real.

El [runbook existente](./local-build-deployment.md) contiene ejemplos de
versiones y scripts antiguos: revisar los comandos de instalacion disponibles en
ese momento; no asumir que un script temporal de otra release sigue existiendo.
No se ha creado una entrada de release construida ni modificado la version de la
aplicacion con esta documentacion.

## Seguimiento

| Fecha      | Hito                         | Evidencia                                                               | Estado                                      |
| ---------- | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| 2026-09-06 | Auditoria inicial            | Checkout `66d9ee06d6`, ayudas CLI y 101 tests focalizados               | Diagnostico; no E2E de produccion           |
| 2026-09-06 | Entorno y plan documentados  | Servidor remoto multicliente confirmado por el usuario                  | Implementacion pendiente                    |
| 2026-09-06 | Sincronizacion               | Merge `ee2e5da315`; typecheck, 190 tests y hooks de commit aprobados    | Integrado localmente, sin push              |
| 2026-09-06 | PI-01, PI-02 y guard ORCH-01 | 708 tests en 32 suites, typecheck Node/CLI/web y quality gate aprobados | Cambios de trabajo sin commit ni despliegue |

### Primer bloque implementado

- PI-01: cola de hasta ocho grupos pendientes, con frontera, ultimo mensaje y ultimo estado por grupo; captura la identidad al encolar y cancela comprobaciones idle de sesiones anteriores. Conserva los eventos del receptor existente y comparte comportamiento con OMP/Prime. Ante sobrecarga descarta grupos antiguos completos; no garantiza historial completo ni limita bytes individuales del payload.
- PI-02: terminador de opciones para prompts Pi. Reutiliza un terminador configurado sin duplicarlo; distingue valores literales `--` usando los argumentos estructurados antes del quoting. Cubre POSIX, PowerShell, cmd y prefijos POSIX de entorno. Los wrappers o flags de extensiones cuya frontera sea ambigua se rechazan, sin modificar settings silenciosamente; el contrato de aridades esta basado en Pi 0.85.
- ORCH-01: rechazo transaccional `task_not_startable` si el ultimo worker fallo por `agent_prompt_stalled` sin settlement. Incluye el caso de Task marcada manualmente ready, no crea recursos de reemplazo y no elimina la autoridad del primer worker. Preserva el reintento tras fallo real reportado o abandon explicito. Los receipts locales y federados normalizan el codigo stalled recibido por RPC.
- No se cambia el esquema wire ni se introduce un opcode. Los consumidores antiguos conocen el codigo de rechazo; un servidor home antiguo no adquiere esta proteccion hasta actualizarse. Un receipt antiguo que ya perdio la causa no puede reconstruirse a partir de un mensaje generico.
- `worker-abandon` invalida autoridad, no mata procesos. La recuperacion automatica tras failed no esta terminada: `worker-stop` puede ser un no-op y el settlement tardio federado sigue pendiente. Inspeccionar antes de abandonar o reemplazar; nunca asumir que la ausencia de contacto equivale a salida.
- El fallback WSL a `curl.exe` ya podia solapar entregas antes del cambio; no queda validado por las pruebas de orden del transporte fetch.

Se observaron regresiones rojas antes de cada fix: perdida de eventos/identidad Pi,
prompts y terminadores preexistentes, tres rechazos de retry ausentes, dos codigos
stalled perdidos en receipts y el bypass de Task ready. Una revision independiente
detecto casos de wrappers/quoting y el bypass; se corrigieron antes de la pasada final.

Verificacion conjunta final sobre estos cambios:

```bash
ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run \
  --config config/vitest.config.ts --maxWorkers=4 \
  src/main/pi src/shared/agent-hook-listener-pi-compatible.test.ts \
  tui-agent-startup tui-agent-config.test.ts tui-agent-launch \
  agent-session-resume.test.ts agent-resume-launch-command.test.ts sleeping-agent-launch-config.test.ts \
  src/main/runtime/orchestration/worker-start-unobserved-prompt-settlement.test.ts \
  src/main/runtime/orchestration/orchestration-worker-dispatch-db.test.ts \
  src/main/runtime/orchestration/db-task-dispatch-races.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-start-outcome-classification.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-start-prompt-contract.test.ts \
  src/main/runtime/rpc/methods/orchestration-federation.test.ts \
  src/main/runtime/rpc/methods/orchestration-dispatch-error-codes.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-launch-preferences.test.ts \
  src/main/runtime/rpc/methods/orchestration-federated-worker-start-receipt.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-stop.test.ts \
  src/main/runtime/rpc/methods/orchestration-worker-release.test.ts \
  src/main/runtime/rpc/methods/orchestration-workers-new-worktree.test.ts \
  src/shared/agent-session-option-catalog.test.ts src/shared/automation-launch-preferences.test.ts
ORCA_BACKGROUND_LAUNCH=1 node config/scripts/run-typecheck-projects-in-parallel.mjs
ORCA_BACKGROUND_LAUNCH=1 ORCA_CODE_QUALITY_BASE=HEAD node config/scripts/check-changed-code-quality.mjs
```

Resultado: 32 suites y 708 tests aprobados; Node/CLI/web sin errores de tipos;
cero findings nuevos en los tres pases de calidad sobre 17 archivos de codigo.
No es una pasada de toda la suite ni una prueba multicliente con agentes reales.

Incidencia de entorno: el primer `pnpm tc` tras actualizar el checkout sincronizo
automaticamente dependencias y ejecuto postinstall/prepare. El script informo de
que no recompilo modulos nativos. No cambio fuentes ni lockfile; las comprobaciones
posteriores usaron Node y los ejecutables instalados directamente para evitar esa
autoinstalacion. No se ha compilado ni sustituido la AppImage de produccion.

Proximo paso: completar identificacion del runtime/clientes e infraestructura de
prueba de Fase 0, y los pendientes de recuperacion y degradacion de Fase 1. No
declarar completada la fase ni desplegar la release solo por este bloque.
