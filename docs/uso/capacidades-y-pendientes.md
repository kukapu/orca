# Capacidades y pendientes

[Volver al indice](./README.md)

Referencia inicial: 2026-09-06. Comprueba siempre el runtime activo: tener codigo
nuevo en el checkout no significa que el servidor ya lo este ejecutando.

## Que puedes hacer hoy

| Necesidad                            | Herramienta o practica                                    | Limite                                                          |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------- |
| Descubrir proyecto, host y workspace | status, host/environment/project/worktree y sus consultas | Revisar el alcance de cada respuesta.                           |
| Delegar y seguir tareas              | Run, Task, Dispatch y worker-start/show/read              | Aceptacion de entrada no implica progreso ni finalizacion.      |
| Coordinar preguntas y resultados     | ask, reply, check y ACK                                   | Autoridad vigente y procesamiento completo del lote.            |
| Reutilizar un agente                 | worker-start con terminal existente para una nueva Task   | No cambia su modelo mediante --model.                           |
| Cambiar modelo sin recrear OpenCode  | Control de su TUI con terminal read/send                  | Prueba real en 1.18.29/Linux; no es un comando atomico de Orca. |
| Parar o liberar trabajo              | worker-stop, worker-release, worker-retain                | Distinguir intento, turno, proceso y propiedad del usuario.     |
| Recuperar contexto de coordinacion   | Checkpoint durable y consulta del Run                     | No perder restricciones ni publicar capabilities.               |

Consulta `orca agent-context --json`, `orca skills list` y la ayuda del subcomando
para la mecanica de la version instalada. No ejecutes instaladores de skills o
proveedores solo para leer documentacion.

## En implementacion o validacion

La release objetivo `1.4.197-kukapu.2` tiene cambios en recuperacion de workers,
lectura estructurada OpenCode/Pi, opciones observadas y un harness multicliente.
No se consideran una entrega completa hasta pasar sus gates.

Pendientes identificados al iniciar esta guia: cerrar la autoridad de sesion y
resume real; rebuild final; E2E simulado y web sobre el codigo final; smoke real
OpenCode/Pi; preparacion del artefacto y gate seguro de instalacion.

El [checkpoint de la ejecucion](../features-kukapu/orchestration-run-197-2.md)
recoge la evidencia actual. El [plan tecnico](../features-kukapu/opencode-pi-orchestration.md)
describe el alcance. No uses este resumen como prueba de que un gate ya paso.

## Consulta de cuotas: propuesta aplazada

Todavia no hay una consulta unificada verificada que diga cuanto queda de cada
proveedor/cuenta/modelo. No hay que implementarla para poder escribir esta guia
ni para terminar los bloques ya acordados.

Cuando se aborde, deberia mostrar fuente, cuenta/ambito sin secretos, momento
de observacion, limite conocido, disponibilidad y reset con zona horaria o
Retry-After fiable. Debe permitir "desconocido" y distinguir presupuestos
compartidos de limites por modelo. Las credenciales permanecen en el host.

Antes de crear endpoints o stores, revisar mecanismos existentes y que datos
ofrece realmente cada proveedor. No inventar saldos ni asumir APIs disponibles.

## Automatizacion futura de recuperacion

Ya sabemos ejecutar el cambio de modelo en una sesion OpenCode viva. Queda
formalizar un flujo que detecte la causa, consulte disponibilidad fiable,
reconozca intervencion manual y garantice un solo responsable antes de continuar.

Debe reutilizar Run/Task/Dispatch y la identidad existente. La recuperacion no
puede basarse solo en el titulo o handle anterior, ni en un error de proveedor
interpretado como muerte del proceso. Las regresiones requeridas estan en el
[incidente de cuota y resume manual](../features-kukapu/orchestration-quota-manual-resume.md).
