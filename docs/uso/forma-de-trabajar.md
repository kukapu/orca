# Forma de trabajar

[Volver al indice](./README.md)

El objetivo no es tener muchos agentes abiertos. Es terminar trabajo util,
verificable y recuperable sin perder contexto ni interferir con el usuario.

## Antes de empezar

1. Entiende el resultado que necesita el usuario y como se comprobara.
2. Lee las instrucciones del proyecto y revisa el trabajo ya existente.
3. Confirma proyecto, workspace, host y Run. Una ruta sola no identifica el host.
4. Comprueba cambios sin commit y agentes que ya trabajan sobre esos archivos.
5. Define que puedes hacer, que necesita aprobacion y que queda fuera del alcance.

Una tarea pequena puede resolverse con un solo agente. Usa varios cuando haya
responsabilidades separables, no para que todos investiguen lo mismo.

## Responsabilidades

| Papel                 | Responsabilidad                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Usuario               | Define el objetivo y las decisiones sensibles; puede intervenir y cambiar prioridades.              |
| Coordinador           | Divide el trabajo, asigna responsables, desbloquea, revisa evidencia y decide los siguientes pasos. |
| Implementador         | Resuelve una tarea acotada, prueba sus cambios y comunica limites.                                  |
| Revisor o verificador | Comprueba supuestos, regresiones y resultados sin duplicar la implementacion.                       |

En un flujo delegado mediante Orca, usa sus Tasks y workers. No abras en paralelo
otra red de subagentes fuera de Orca para la misma responsabilidad.

## Paralelismo con limites

Asigna archivos o responsabilidades concretas a cada implementador. Si dos
tareas necesitan cambiar el mismo contrato, acuerda primero quien lo modifica.
No lances builds mientras otro agente esta cambiando sus fuentes.

Ejemplo: documentacion y una correccion de hooks pueden avanzar a la vez. El E2E
final que depende de esos hooks espera a que terminen y se reconstruya el bundle.

Un workspace compartido no protege de ediciones concurrentes. Si aparece trabajo
ajeno, no lo reviertas; identifica al responsable y coordina la integracion.

## Intervencion del usuario

Que el usuario cambie el modelo de un agente o lo reanude es normal. Revisa esa
intervencion antes de parar, reemplazar o volver a cambiar algo. Conserva su
sesion y su eleccion salvo una razon concreta que debas consultar.

No interpretes una pestana reaparecida como basura ni el titulo de una pestana
como identidad suficiente. Puede ser una sesion que el usuario esta utilizando.

## Comunicar sin ruido

Una nota informativa del usuario no pausa el objetivo en curso. Incorpora el dato
(por ejemplo, que vuelve a haber cuota) y sigue con los siguientes pasos. No
termines el trabajo para limitarte a confirmar cada mensaje. Cambia el horizonte
solo ante una redireccion o pausa explicita, o un bloqueo que requiera decision.

Explica descubrimientos, bloqueos, decisiones y resultados. No anuncies como
terminado algo que solo ha aceptado un prompt. Distingue "implementado",
"verificado", "compilado" e "instalado".

Cuando preguntes, describe el bloqueo y la decision minima que necesitas.
Cuando entregues, incluye cambios, comandos de comprobacion, resultados y limites.

No hagas commit, push, instalaciones globales o reinicios de produccion por
inercia. Una autorizacion para programar no los convierte en pasos automaticos.
