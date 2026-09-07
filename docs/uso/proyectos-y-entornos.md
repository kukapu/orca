# Proyectos y entornos

[Volver al indice](./README.md)

Antes de ejecutar una orden, responde: **que proyecto, en que carpeta, en que
maquina y bajo que runtime**. Asi evitas actuar sobre una copia o un host distinto.

## Conceptos utiles

| Concepto          | Que significa                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Proyecto          | El trabajo durable que Orca conoce, con sus posibles instalaciones en hosts.             |
| Workspace         | La carpeta de trabajo concreta; puede ser un worktree Git o una carpeta sin Git.         |
| Host de ejecucion | La maquina que posee los archivos, herramientas, procesos y credenciales de ese trabajo. |
| Runtime           | El proceso de Orca que ofrece las operaciones de control.                                |
| Entorno guardado  | Una conexion a otro runtime Orca emparejado; no es simplemente una carpeta SSH.          |
| Cliente           | La interfaz desde la que observas o controlas el runtime.                                |

## Descubrir antes de crear

Estas consultas ayudan a situarse; revisa el alcance y los identificadores de
sus respuestas antes de hacer cambios:

```bash
orca status --json
orca host list --json
orca environment list --json
orca project list --json
orca worktree current --json
orca orchestration run-current --json
```

Usa los selectores y handles que devuelve Orca. No reutilices un identificador
de una conversacion antigua sin comprobar que sigue representando lo mismo.
No vuelvas a registrar, clonar o crear un proyecto que ya esta disponible.

## Dos formas de trabajar en remoto

**Orca Remote Server emparejado.** El servidor mantiene su runtime y el control
de su trabajo. Para orquestaciones largas, situar alli coordinador y Run evita
depender de una ventana de escritorio. Los clientes ofrecen la interfaz.

**Workspace mediante SSH desde un cliente.** Los archivos y procesos estan en
el host SSH, pero el control plane puede depender del cliente. El shim `orca`
puede dejar de estar disponible al desconectar ese cliente aunque el proceso
remoto siga ejecutandose. No prometas la misma autonomia que un servidor emparejado.

No mezcles ambos registros para la misma maquina sin una decision explicita.
Consulta el [contrato SSH](../reference/ssh-execution-boundary.md) para sus limites.

## Reglas practicas

- Nunca ejecutes localmente una operacion remota como fallback silencioso.
- Una carpeta sin Git es un workspace valido: no fuerces ramas ni worktrees.
- Crear un workspace puede ejecutar setup hooks. Revisa su politica antes de hacerlo.
- Usa las rutas y herramientas del host que ejecuta, no las del ordenador cliente.
- Respeta macOS, Linux, Windows y WSL; no copies sintaxis de shell entre ellos sin comprobarla.
- En revisiones de codigo, no presupongas GitHub: respeta el proveedor del proyecto.
- Las credenciales pertenecen al host de ejecucion. No las copies a prompts, logs o fixtures.

## Ramas Del Fork Orca

Nuestra rama principal y predeterminada es `main-kukapu`; su tracking y base
habitual de comparacion son `origin/main-kukapu`. El oficial `upstream/main`
solo se incorpora mediante sincronizacion verificada, sin PRs automaticas ni
pasar por `main` local. El agente diario trabaja en su propio worktree y no
recoge WIP ni actualiza el checkout principal de otros agentes. Contrato y prompt:
[flujo del fork](../reference/upstream-sync-automation.md).

## Si se pierde la conexion

Los veredictos de proceso son `live`, `unverifiable` y `exited`. Un timeout o
una lista vacia desde un cliente desconectado no demuestra `exited`.

Reconexion, reinicio del servidor y reinicio del relay son cosas diferentes.
No reinicies infraestructura para recuperar una interfaz sin comprobar primero
que trabajos aloja. Lee [Modelos y recuperacion](./modelos-y-recuperacion.md).

Clientes y servidor pueden tener versiones distintas. Descubre las capacidades
de ambos; no fuerces una funcion ausente ni asumas que actualizar uno actualiza
el otro. Referencia: [compatibilidad remota](../reference/remote-wire-compatibility.md).
