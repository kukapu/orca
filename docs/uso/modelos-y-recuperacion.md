# Modelos y recuperacion

[Volver al indice](./README.md)

Si un agente se bloquea, **averigua la causa antes de sustituirlo**. Cuando el
problema es el proveedor y hay otro modelo autorizado con disponibilidad conocida,
la primera opcion es cambiarlo dentro de la misma sesion y continuar.

## Elegir modelo

Considera adecuacion a la tarea, coste, contexto disponible, herramientas y
cuota del proveedor/cuenta. Un nombre de modelo no identifica su proveedor.
Respeta los identificadores autorizados por el usuario; si se requiere
`xai/grok-4.6`, otro proveedor con un modelo llamado Grok no es equivalente.

El catalogo indica que un modelo esta configurado, no que tenga cuota. Una
peticion reciente correcta demuestra disponibilidad en ese momento, no un saldo
exacto ni una garantia para todo el trabajo. No inventes porcentajes restantes.

La consulta unificada de cuotas esta **pendiente**. Hasta entonces usa evidencia
reciente del proveedor o del usuario. Si no conoces una alternativa disponible,
pregunta o espera; no pruebes cuentas y modelos a ciegas en bucle.

## Distinguir el bloqueo

| Situacion                                         | Primera respuesta                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cuota agotada o rechazo persistente del proveedor | Registrar causa; comprobar alternativa autorizada y cambiar en la misma sesion. |
| Error de autenticacion                            | Revisar autorizacion en el host, sin exponer claves; no confundirlo con cuota.  |
| Fallo de red                                      | Comprobar conectividad y efectos ya iniciados; no deducir que el proceso salio. |
| Espera de permiso o respuesta                     | Resolver la pregunta o permiso pertinente, no cambiar modelo automaticamente.   |
| Test o compilacion fallidos                       | Investigar el defecto; no tratar un cambio de modelo como solucion del codigo.  |
| Herramienta que sigue ejecutandose                | Averiguar su estado y si interrumpirla es seguro antes de reenviar trabajo.     |

No compartas el mismo presupuesto agotado entre nuevos workers como supuesto
fallback. Si hay un reset fiable, registra fuente y hora; no interpretes una
hora sin zona horaria ni un porcentaje antiguo como dato actual.

## Cambiar dentro de OpenCode

Recorrido probado con OpenCode 1.18.29 en Linux; comprobarlo de nuevo si cambian
la TUI o sus atajos. No se ha validado este mismo procedimiento para Pi.

1. Identifica el terminal y Dispatch actuales. Comprueba si el usuario ya lo ha reanudado.
2. Lee la TUI y confirma el bloqueo o la operacion que puedes interrumpir.
3. Interrumpe solo el turno, si sigue activo. En la prueba hicieron falta dos Escape consecutivos.
4. Confirma `interrupted` y que el proceso sigue `live`. `bytesWritten` no basta.
5. Abre `/models`, busca por nombre visible y distingue el proveedor correcto.
6. Selecciona y verifica el modelo actual en la TUI antes de enviar otro prompt.
7. Pide continuar desde el punto interrumpido, sin repetir efectos ya completados.
8. Comprueba progreso, contexto y autoridad del mismo Dispatch.

`orca terminal send` permite enviar texto, Enter y bytes de teclado. En el host
Bash de la prueba, Escape se envio como `--text $'\x1b'`. No uses `--interrupt`
como sinonimo de Escape: envia Ctrl+C y puede tener otro efecto en la aplicacion.
No pulses Enter a ciegas: el filtro puede mostrar el mismo nombre en varios proveedores.

No uses worker-stop, cierre de terminal, un nuevo worker-start ni cambios de
configuracion global para este cambio en una sesion viva. Los startOptions
siguen describiendo el modelo del lanzamiento; no prueban el modelo actual.

Antes de cambiar, comprueba tambien el limite de contexto del destino. Si el
historial no cabe, compacta en un punto seguro y conserva el checkpoint y la
autoridad vigente. Tras compactar, verifica un heartbeat autorizado antes de
seguir: el resumen no sustituye el estado durable y puede omitir pasos ya hechos.
En el cambio Muse -> GLM 5.3, los historiales superaban los 300.000 tokens que
admitia GLM; la compactacion permitio continuar sin recrear los agentes.

## Compactar sin abandonar el trabajo

No confundas resumir el contexto con reanudar la ejecucion. En OpenCode 1.18.29,
el comando TUI `/compact` llama a `session.summarize` sin `auto`; el servidor usa
`auto: false`. La continuacion sintetica del agente se crea solo con `auto: true`.
Cambiar `agent.compaction.model` cambia quien resume, no esa decision de control.

El coordinador NO debe enviarse `/compact` y prometer que seguira por si solo.
Prefiere la compactacion automatica del runtime. Si hace falta compactar
manualmente durante un trabajo activo, prepara primero el checkpoint y una
reanudacion supervisada por un actor externo que sobreviva al turno. Ese actor
debe confirmar fin de compactacion, misma sesion y autoridad, ausencia de pausa
humana y de un turno ya reanudado antes de enviar una unica continuacion. No uses
temporizadores ciegos, prompts repetidos ni un plugin que reanude cualquier sesion
idle del usuario.

La API `session.summarize` admite `auto: true`, pero su integracion en nuestro
flujo sigue pendiente de prueba aislada: exigir un paso posterior observable,
sin que el usuario escriba "continua". Un resumen correcto no basta como gate.

Orca no publica hoy la URL de la instancia OpenCode ni tiene un canal de control
hacia su plugin de estado; ese plugin envia eventos a Orca, no recibe ordenes.
No inventes un comando de compactacion de Orca. Una llamada externa a summarize
requiere endpoint conocido, sesion y modelo explicitos, y debe correlacionar la
continuacion con esa solicitud, no con cualquier compactacion historica. El
coordinador se identifica por Run/generacion, no por un Dispatch de worker.

Fuentes versionadas: [comando TUI](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/tui/src/routes/session/index.tsx),
[handler summarize](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts)
y [continuacion](https://github.com/anomalyco/opencode/blob/v1.18.29/packages/opencode/src/session/compaction.ts).

## Si interviene el usuario

El usuario puede cambiar modelo y decir "continua". Conserva esa sesion y su
contexto. Revisa todo el inventario pertinente: puede tener un handle nuevo.
No lances un reemplazo en paralelo porque solo miraste el intento anterior.

Si la capability anterior ya fue revocada, reengancha el terminal existente a
un Dispatch nuevo. No reutilices la autorizacion antigua ni ignores su rechazo.
Si ya hay duplicados, acuerda cual conservar, detiene solo el otro y verifica
salida e inventario sin revertir los archivos que ambos hayan tocado.

## Lo que comprobamos

La prueba Grok 4.6 -> interrupcion -> Muse Spark 1.3 Contributor mantuvo terminal,
encarnacion y Dispatch. El nuevo modelo recordo una clave del historial y pudo
reportar con la autorizacion original. Eso prueba el mecanismo, no una deteccion
automatica de cuota ni la seguridad de interrumpir cualquier herramienta.

Evidencia y limites: [incidente y prueba real](../features-kukapu/orchestration-quota-manual-resume.md).
