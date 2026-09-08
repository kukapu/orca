# Verificacion y entrega

[Volver al indice](./README.md)

Una entrega necesita evidencia. Un agente que dice "terminado", un turno idle
o una Task completed no demuestran por si solos que el resultado sea correcto.

## Que significa cada paso

| Paso                     | Evidencia necesaria                                                         |
| ------------------------ | --------------------------------------------------------------------------- |
| Implementado             | Cambios presentes, alcance revisado y limitaciones explicitas.              |
| Verificado               | Pruebas y checks pertinentes ejecutados sobre esos cambios.                 |
| Compilado                | Build correcto de la revision que se quiere entregar.                       |
| Probado en la aplicacion | Escenario ejecutado sobre ese build, con entorno y cobertura identificados. |
| Instalado                | Artefacto desplegado, version activa y salud comprobadas en el destino.     |

## Revisar un entregable

1. Comprueba autoridad del reporte y archivos realmente cambiados.
2. Lee el diff, sobre todo identidades, errores, concurrencia y compatibilidad.
3. Reproduce el defecto y verifica la correccion con casos que atraviesen la ruta real.
4. Ejecuta typecheck, lint y pruebas focalizadas antes de ampliar el coste de validacion.
5. Registra comandos, revision, entorno, resultados, omisiones y limites.

No conviertas un error previo en un gate verde: indica que sigue fallando y
separa su causa de los cambios nuevos. Tampoco des por cierta su antiguedad sin
evidencia. No uses pipelines a tail/head que escondan el codigo de salida del test.

Para comparar con una revision anterior, no retires cambios del workspace
compartido mediante stash, reset o checkout. Lee la revision sin modificar el
arbol o pide autorizacion para una prueba aislada. No afirmes "sin mutaciones
Git" si has usado esos comandos, aunque luego hayas restaurado los archivos.

## Probar sin afectar al usuario

Usa datos, homes, perfiles, puertos y procesos aislados. No copies bases de
produccion ni credenciales completas para hacer funcionar una fixture.
Autoriza por separado un smoke que gaste LLM y limita sus tareas.

En este repositorio, tests y apps lanzados por agentes llevan
`ORCA_BACKGROUND_LAUNCH=1`. Las pruebas Electron siguen AGENTS y los helpers de
Playwright/CDP; no roban foco ni muestran ventanas en el escritorio del usuario.
Las pruebas que requieran ventanas visibles van a un display aislado o CI.

Reconstruye las fuentes modificadas antes de validar el bundle. No saltes un
control de build obsoleto para obtener un verde ni construyas durante ediciones
concurrentes de esas fuentes. Revisa permisos antes de instalar o reconstruir
dependencias; un comando habitual puede tener efectos adicionales en ese entorno.

Para tests que preparan estado mediante `window.__store`, el bundle Electron
necesita `--mode e2e` y el bundle web independiente necesita
`VITE_EXPOSE_STORE=true` al compilarse. Una opcion no configura el otro bundle.
No diagnostiques un fallo de hidratacion a partir de un global que el build no
expone. Antes de empaquetar, reconstruye ambos en modo produccion y sin ese flag.

## Nombrar bien la cobertura

- Un test unitario no sustituye una prueba de aplicacion.
- Un fake que usa hooks reales prueba esa integracion, no el proveedor LLM real.
- Dos conexiones RPC no son dos aplicaciones de escritorio.
- Version/help de un binario no prueban que complete una tarea.
- Un marcador en el prompt no prueba que el asistente haya respondido.
- Un pase sobre un build anterior no valida cambios posteriores.
- Un test omitido no cuenta como aprobado.

## Entregar y limpiar

Antes de instalar, confirma destino, aprobacion, backup, rollback y una ventana
segura. Reiniciar el servidor que aloja al coordinador puede terminarlo junto con
otros agentes. Prepara un ejecutor externo o entrega el artefacto con la instalacion
pendiente; no cortes trabajo ajeno para cerrar una checklist.

Despues comprueba la version activa y la salud, no solo el exit code del instalador.
No hagas commit, push o publicacion sin autorizacion. Una entrega puede ser util
y verificable aunque una instalacion de produccion quede explicitamente bloqueada.

Libera los workers terminados que ya no se necesiten y revisa el inventario.
Conserva los que el usuario mantiene para revisar o continuar. Archivar un resultado
no autoriza a borrar sus archivos ni a cerrar otros procesos de ese host.
