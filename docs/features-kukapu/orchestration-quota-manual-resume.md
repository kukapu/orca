# Cuota agotada y reanudacion manual concurrente

Incidente observado el 2026-09-06 en `run_3bc1b0c65acb`. Este documento registra
el aprendizaje y el contrato requerido para futuros flujos; NO afirma que las
protecciones propuestas ya esten implementadas en el runtime.

## Que ocurrio

1. Dos workers GLM 5.3 recibieron `Usage limit reached for 5 hour`. El coordinador
   identifico correctamente la cuota, no un fallo funcional de sus tareas.
2. El usuario cambio manualmente el modelo y reanudo las sesiones. En paralelo,
   el coordinador paro los intentos conocidos y lanzo reemplazos Grok 4.6.
3. El host confirmo `exited` para las encarnaciones paradas, pero las sesiones
   reanudadas aparecieron con otros handles/PTYs. Esa observacion de salida no
   garantizaba que el trabajo logico no pudiera continuar en otra encarnacion.
4. Hubo dos ejecutores por tarea sobre el mismo checkout. Los informes de las
   sesiones originales fueron rechazados porque sus capabilities estaban revocadas.
   El fencing del reporte funciono, pero no impidio ediciones fuera del control plane.
5. Por indicacion del usuario se cerraron los reemplazos mas recientes y se
   conservaron las sesiones que el habia reanudado, con su modelo y contexto.

El usuario indico unos 42 minutos restantes para recuperar cuota en ese momento.
No interpretar la hora mostrada por el proveedor como UTC si no incluye zona
horaria, ni convertir aquel intervalo puntual en un cooldown permanente.

## Regla operativa

**Cuota agotada no significa proceso terminado ni autoriza por si sola reemplazo.**
Mantener separados el bloqueo del proveedor, la liveness del proceso
(`live` / `unverifiable` / `exited`), el resultado de la tarea y la autoridad vigente.

1. Registrar proveedor/modelo y evidencia del limite. Aplicar cooldown al ambito
   de cuota compartido, no reintentar desde otro worker de la misma cuenta.
2. Antes de parar o reemplazar, reconciliar intervencion humana, modelo observado,
   progreso reciente e identidad de sesion en TODO el inventario del host ejecutor.
   No basta el handle antiguo ni el titulo de una pestana.
3. Si el usuario ha cambiado modelo o reanudado, conservar esa sesion por defecto.
   Si no puede probarse que hay un unico ejecutor o la intencion humana es ambigua,
   pedir una decision breve antes de crear, cerrar o volver a cambiar modelo.
4. Preferir continuar la sesion existente para conservar contexto. Un cambio de
   modelo en un proceso vigente no debe exigir recrear el worker innecesariamente.
5. Si cambio la encarnacion o se revoco la capability, reenganchar la sesion elegida
   mediante un NUEVO Dispatch autorizado sobre su terminal existente. No revivir
   capabilities viejas, falsificar worker_done ni relanzar el trabajo desde cero.
6. Si se necesita reemplazo, comprobar exclusividad otra vez inmediatamente antes
   de arrancarlo y despues. `exited` prueba la salida de una encarnacion concreta,
   no la ausencia de una reanudacion posterior de la misma tarea.
7. Ante duplicados, el coordinador y el usuario eligen un unico propietario. Parar
   solo el intento descartado y verificar salida e inventario. Conservar todos los
   cambios; revisar posibles solapamientos sin reset/stash/revert automaticos.
8. Un worker con autoridad revocada debe dejar de editar/reportar y esperar un
   reenganche explicito. Un resumen rechazado puede orientar una revision, pero
   no completa la Task ni convierte sus tests declarados en gates aceptados.

## Requisitos De Producto Pendientes

El mecanismo manual de cambio en la misma TUI ya se comprobo en la prueba de
abajo. Sigue pendiente automatizar su deteccion, coordinacion y verificacion
como flujo del runtime.

- Reutilizar Run/Task/Dispatch, identidad de sesion y ownership existentes; no crear
  un scheduler ni una segunda fuente de verdad para resolver esta carrera.
- Representar cuota/cooldown como diagnostico del proveedor separado de liveness.
- Reconciliar resume y cambio manual de modelo como transiciones de ownership de
  la tarea, incluso con nuevos handles, PTYs, clientes o conexiones.
- Serializar o aplicar compare-and-swap al traspaso de ownership y la decision de
  retry. Dos snapshots separados no eliminan la carrera entre el usuario y el coordinador.
- La reanudacion debe comprobar autoridad antes de efectos sobre archivos; revocar
  solo el permiso para reportar no evita dos implementadores sobre el mismo checkout.
- Publicar campos nuevos como opcionales y negociar cambios de comportamiento
  cuando corresponda. La autoridad reside en el host; desconexion no prueba salida.

## Regresiones Requeridas

- Cuota sin intervencion: no duplicar workers ni consumir mas intentos del proveedor bloqueado.
- Cambio manual de modelo antes de retry: continuar el original, conservar contexto.
- Resume manual DURANTE stop/retry: terminar con un solo propietario, sin dobles editores.
- Original confirmado exited y luego reanudado con nuevo handle: reconocer la misma tarea/sesion.
- Report tardio con capability revocada: rechazarlo y permitir reenganche sin perder artefactos.
- Dos clientes actuando a la vez, perdida de contacto y reconexion: no deducir salida ni ownership por ausencia.
- Cooldown sin zona horaria/Retry-After fiable: no inventar la hora de restablecimiento.

## Prueba Real De Cambio En La Misma Sesion

Ejecutada por orden del usuario el 2026-09-06, 13:16-13:21 UTC, con OpenCode
1.18.29 en este host Linux. No se tocaron los dos agentes de implementacion.

| Evidencia                       | Resultado                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Task                            | `task_7b3ffb59b176`                                                                                                 |
| Dispatch durante toda la prueba | `ctx_cc21d61c0733`                                                                                                  |
| Terminal durante toda la prueba | `term_e12d4c26-2a97-42b1-adf1-4125b80c9fed`                                                                         |
| Encarnacion antes y despues     | `7573fd24-b1fd-4caa-86f3-83d477b2770c`                                                                              |
| Modelo inicial                  | `xai/grok-4.6`, confirmado en TUI como Grok 4.6 xAI                                                                 |
| Interrupcion                    | `sleep 180` en ejecucion; dos Escape consecutivos produjeron `User aborted the command` y turno `interrupted`       |
| Modelo posterior                | `opencode-go/muse-spark-1.3-contributor`, confirmado en TUI como Muse Spark 1.3 Contributor OpenCode Go             |
| Unico prompt de continuacion    | `CONTINUA_PRUEBA`, sin repetir la clave inicial                                                                     |
| Respuesta del nuevo modelo      | `NARVAL-731946 CONTEXTO_CONSERVADO`                                                                                 |
| Autoridad                       | `worker_done` aceptado, `msg_1c9e79cfbe76`, mismo Dispatch y capability hasta su settlement normal                  |
| Cierre posterior                | worker-release: released / closed_agent_terminal, archivo captured; inventario vuelve a los tres terminales previos |

Secuencia usada: leer TUI; enviar Escape dos veces; comprobar interrupcion;
abrir `/models`; filtrar por nombre visible; comprobar proveedor; confirmar
seleccion; comprobar el pie de TUI; enviar continuacion; verificar respuesta,
identidad y reporte. No usar worker-stop para pausar un turno: termina el intento
y puede revocar autoridad, mientras Escape actua dentro de OpenCode.

En esta version una pulsacion aislada de Escape no detuvo el turno. El filtro
`muse-spark-1.3-contributor` no encontro resultados: `Muse Spark 1.3 Contributor`
mostro OpenCode Go y Meta. Se eligio OpenCode Go y se verifico ANTES de continuar.
No automatizar un Enter ciego sobre nombres que aparecen en varios proveedores.

Las entradas se enviaron con `orca terminal send --text ...` y `--enter`, sin
focus/show ni cambio de proceso. Para Escape se uso el byte 0x1b; en Bash,
`--text $'\x1b'`. Para limpiar el filtro se uso Ctrl+U (0x15). Estos detalles de
teclado deben verificarse para la version/configuracion de TUI correspondiente.

Alcance: prueba real del control pausa/cambio/continuacion, conservacion de
contexto y autoridad. NO induce una cuota real ni valida deteccion automatica de
429, cooldown, fallo de red, Pi u otras versiones/plataformas. Los startOptions
siguen describiendo el lanzamiento con Grok: no representan el modelo actual.
