# Como trabajar con Orca

Esta carpeta explica, en castellano y para agentes, **como queremos trabajar**:
que decisiones tomar, que herramientas elegir y que comprobar antes de avanzar.
Tambien sirve al usuario para revisar y mejorar esa forma de trabajo.

No es un registro de una release ni una lista de promesas. Los identificadores,
cuotas, versiones activas y tareas de cada ejecucion van en su checkpoint, no aqui.

## Por donde empezar

| Si necesitas...                                    | Lee...                                                    |
| -------------------------------------------------- | --------------------------------------------------------- |
| Entender las prioridades y responsabilidades       | [Forma de trabajar](./forma-de-trabajar.md)               |
| Saber donde estan el proyecto y sus procesos       | [Proyectos y entornos](./proyectos-y-entornos.md)         |
| Dividir, asignar y supervisar trabajo              | [Orquestacion](./orquestacion.md)                         |
| Elegir modelo o recuperar un agente bloqueado      | [Modelos y recuperacion](./modelos-y-recuperacion.md)     |
| Decidir si algo esta terminado y se puede entregar | [Verificacion y entrega](./verificacion-y-entrega.md)     |
| Distinguir lo disponible de lo que falta           | [Capacidades y pendientes](./capacidades-y-pendientes.md) |

Antes de actuar, lee las instrucciones del proyecto y descubre el runtime,
workspace y Run actuales. Si ya existe una ejecucion, retomala: no crees otra por
haber perdido contexto o cambiado de cliente.

## Como encaja con el resto

- Esta guia recoge criterios de trabajo: **cuando, por que y con que limites**.
- Las skills y `orca <comando> --help` explican la mecanica de la version instalada.
- [AGENTS.md](../../AGENTS.md) contiene las restricciones del repositorio.
- `docs/reference/` contiene contratos tecnicos de SSH, compatibilidad y plataformas.
- `docs/features-kukapu/` conserva planes, incidentes y evidencias de implementacion.
- `docs/releases/` describe entregas; no prueba por si solo que esten instaladas.

Si una orden explicita del usuario cambia una preferencia, registra la decision
y respeta las restricciones de seguridad. Si las fuentes se contradicen, no
inventes una compatibilidad: comprueba la version y plantea la duda concreta.

## Como mantener esta guia

Escribe una regla sencilla, un ejemplo y el limite que evita un error. Enlaza la
evidencia tecnica en vez de duplicarla. Marca las propuestas como pendientes y
revisa la guia cuando una prueba cambie lo que sabemos. No incluyas secretos,
capabilities, codigos de emparejamiento ni supuestas cuotas actuales.

Primera revision: 2026-09-06. El estado de las capacidades y el alcance de las
pruebas estan en [Capacidades y pendientes](./capacidades-y-pendientes.md).
