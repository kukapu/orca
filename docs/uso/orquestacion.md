# Orquestar trabajo

[Volver al indice](./README.md)

Un **Run** agrupa una ejecucion. Una **Task** describe un resultado. Un
**Dispatch** autoriza un intento concreto de resolver esa Task. El **worker**
es el agente que la ejecuta. No confundas estas identidades con una pestana.

## Preparar una tarea

Incluye objetivo, archivos o area exclusiva, dependencias, comprobaciones,
acciones permitidas y condiciones para pedir ayuda. Describe que significa
terminar y que evidencia debe entregar. Un "arregla todo" no es una buena Task.

Ejemplo de encargo:

```text
Corregir la lectura de eventos tardios en el modulo asignado.
No tocar el harness E2E ni la configuracion global.
Reproducir el fallo antes del cambio y ejecutar las pruebas focalizadas despues.
Preguntar si hace falta cambiar un contrato compartido.
Entregar archivos, comandos, resultados y limites.
```

## Crear o reutilizar

Consulta primero `orca orchestration run-current --json` y el checkpoint. Si
existe un Run pertinente, continua alli. Para la sintaxis de creacion usa
`orca orchestration run-create --help` y `task-create --help`.

Para un worker nuevo, elige explicitamente agente y modelo. Para una tarea nueva
en un agente ya disponible, reutiliza su terminal y su contexto. Los siguientes
son esquemas: sustituye los identificadores por valores recien consultados.

```text
orca orchestration worker-start --task <task_id> --run <run_id> --worktree <workspace> --agent opencode --model <provider/model> --json
orca orchestration worker-start --task <task_id> --run <run_id> --worktree <workspace> --terminal <terminal_existente> --json
```

No combines `--model` con `--terminal`: ese flag configura un lanzamiento nuevo,
no cambia el modelo de una TUI existente. Para eso sigue la
[recuperacion dentro de la sesion](./modelos-y-recuperacion.md).

Un resultado `input_accepted` solo confirma aceptacion de entrada. Comprueba que
el agente realmente ha empezado antes de asignarle mas trabajo.

## Supervisar y desbloquear

Usa `worker-show` para el intento y `worker-read` para salida acotada. Revisa el
origen de la salida, las advertencias, el host y la identidad. Si obtienes un
tail de terminal, no lo presentes como transcripcion completa del proveedor.

El coordinador consulta `orca orchestration check --run <run_id> --json`. Con
`--wait` puede esperar mensajes. Entre subpasos interesa recibir tambien avances,
no filtrar siempre solo preguntas o finalizaciones.

Procesa **todo** el lote: identifica el Dispatch, atiende preguntas y registra
resultados. Despues confirma el `deliveryId` con `--ack`. Confirmar recepcion no
significa aceptar tecnicamente una entrega. No relances por una escalacion vieja
de un intento que ya fue sustituido.

Encolar una indicacion no garantiza que un agente idle la lea. Comprueba progreso
y correo pendiente. Si su Dispatch sigue activo y espera instrucciones, reanuda
esa misma TUI para que consulte el correo, sin crear otro worker. Si hay una
pregunta bloqueante, responde su ID; un mensaje separado no sustituye la respuesta.
Si el Dispatch ya termino, usa una nueva Task/Dispatch sobre el terminal conservado.

El worker usa `ask` para una decision bloqueante y el coordinador `reply` para
responder. Si caduca la espera, consulta o retoma la pregunta existente: no
crees copias que puedan recibir respuestas contradictorias.

## Autoridad y resultados

La capability del preambulo autoriza al worker a reportar por su Dispatch. Es
un secreto: no la publiques en documentacion ni la sustituyas por otra inventada.
Si se revoca, deja de producir efectos y solicita reenganche; no repitas el report
indefinidamente ni continues editando como si siguieras siendo el responsable.

`worker_done` aceptado registra el resultado del intento. El coordinador aun
debe revisar diff y pruebas. Si solo termino un subpaso, quedan pendientes los
gates del bloque completo, aunque una Task figure como completed.

## Cierre y recuperacion

- Reutiliza un agente si conserva contexto util; una nueva Task recibe un nuevo Dispatch.
- Usa `worker-release` para un worker terminado que ya no necesitas y comprueba archivo e inventario.
- Respeta `retained` y su motivo. No fuerces un cierre de una sesion del usuario sin autorizacion.
- Pausar un turno no es `worker-stop`; detener el intento puede revocar su autoridad.
- `worker-abandon` revoca autoridad, pero no demuestra que el proceso haya terminado.
- Antes de un reemplazo, descarta trabajo duplicado, incluida una reanudacion manual con nuevo handle.

Si una mutacion pierde su respuesta, consulta su request ID con `request-show`
antes de repetirla. Un resultado desconocido no prueba que no haya tenido efectos.
`--retry-of` requiere un intento previo elegible y Task failed/blocked; cambiarla
a ready no debe usarse para saltarse la seguridad de un reintento incierto.

Guarda un checkpoint antes de compactar o cambiar de coordinador: objetivo,
Run, Tasks/Dispatches vigentes, host, responsables, evidencias, preguntas, gates
y siguiente accion. No basta una lista de tareas sin su estado verificable.
