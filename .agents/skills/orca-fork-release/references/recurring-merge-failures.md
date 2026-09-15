# Fallos recurrentes de integracion

Revisar esta lista justo despues del merge, antes de un build costoso. Derivada
de la .200 y de la reconciliacion .203; no aplicar fixes mecanicamente sin
comprobar que la nueva implementacion conserva el mismo contrato.

| Patron                                        | Evidencia y causa                                                                                                                                                                                                                                     | Comprobacion temprana                                                                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modulo movido, comportamiento perdido         | En .200, `de03436268` reparo imports de worker-output despues de una reorganizacion. En .203 se recupero la lectura de legacy pins desde la implementacion .198: el lector nuevo no conservaba esa rama aunque las pruebas propias seguian presentes. | Seguir imports de los consumidores reales y comparar implementacion anterior/nueva, no solo paths con conflicto. Ejecutar tests de archivo, journal, cursores y autoridad del host.                               |
| WSL confundido con SSH                        | `45a509f471` corrigio worker-output en .200. El mismo problema reaparecio en el camino de captura de archivos: `connectionId = wsl:*` activaba el rechazo por proveedor remoto ausente.                                                               | Probar lectura viva Y archivo. Usar el clasificador WSL existente y la distro atestada; sin ella no adivinar host ni rutas.                                                                                       |
| Tipos nuevos y mocks incompletos              | `.200` incorporo `blockedPanes`; `.203` requirio Run explicito, snapshot fleet y evidencia positiva de liveness/composer en fixtures.                                                                                                                 | Actualizar fixtures con evidencia que representa el escenario. Mantener assertions de identidad, ausencia de efectos y estado final; no convertir `unverifiable` en `live` en produccion para satisfacer un mock. |
| Cola que lee metadata global al vaciarse      | La cola Pi retenia el evento pero consultaba la ruta de la sesion actual al enviar, mezclando sesiones tras reload.                                                                                                                                   | Retrasar transporte, cambiar sesion y comprobar que modelo, session id y ruta siguen siendo los capturados.                                                                                                       |
| Fixtures de DB falsamente historicas          | Crear con el constructor actual y luego bajar `user_version` deja columnas futuras. Las protecciones del fork lo rechazan correctamente.                                                                                                              | Construir con DDL historico congelado; verificar migracion y preservacion de filas. Para tests de operaciones tras abrir, comparar schema/stamp antes y despues de ESA operacion.                                 |
| Compatibilidad legacy aplicada al flujo nuevo | Protecciones para fork39 inmovil daban errores en las fases actuales de pointer/settlement y workers structured.                                                                                                                                      | Separar por perfil validado, conservar no-DDL/no-replay de fork39 y las migraciones oficiales. Archivo disponible no prueba exit.                                                                                 |
| Metodos de prototipo que se sobrescriben      | El registro upstream de role-mailbox reemplazaba el lector acotado del fork.                                                                                                                                                                          | Revisar orden de attach y nombres duplicados; reutilizar el lector comun que filtra Run y mailbox. Probar ids ajenos dentro de una Delivery.                                                                      |
| Custodia cambia durante el arranque           | La autoridad propia rechazaba un recurso exacto que el usuario habia reclamado mientras arrancaba.                                                                                                                                                    | Probar takeover desde escritorio/movil durante boot: rebind conserva `user_owned`, y release nunca cierra ese recurso.                                                                                            |
| Presupuestos de longitud al combinar codigo   | En .200, `11c5c2389c` corrigio keys de TaskList; en .203 los hooks detectaron max-lines en tests de comandos y hook-server.                                                                                                                           | Ejecutar hooks normales. Extraer por responsabilidad conservando pruebas; nunca elevar limites ni desactivar max-lines.                                                                                           |
| Guia compacta crece con anexos propios        | Las notas de persistencia/ocupacion excedian el presupuesto del kernel de orquestacion.                                                                                                                                                               | Mover detalle a la referencia correspondiente y regenerar el bundle. Comprobar kernel, referencias, manifest y CLI empaquetado.                                                                                   |
| pnpm en HOME aislado                          | El launcher intentaba usar un placeholder de pnpm sin su binario. Cloud con pnpm12 requirio aprobar explicitamente el build de esbuild.                                                                                                               | Resolver la instalacion real disponible, comprobar version y mantener HOME/XDG privados. Aprobar solo paquetes revisados por nombre, sin prompts ni cambios globales.                                             |

## Calidad de una resolucion de merge

Si upstream introduce una regla nueva, un diff contra la base vieja puede atribuir
cientos de findings a codigo byte-identico al tag oficial. Conservar ese reporte
y clasificarlo antes de editar cientos de lineas que no se escribieron en el merge.

El gate existente admite un alcance explicito de **resolucion**, manteniendo
intacto el modo normal:

```text
pnpm run check:code-quality:changed <C_ANTERIOR> --merged-source=<TAG_OFICIAL>
```

El tag debe ser ancestro del candidato. Se revisan las lineas nuevas respecto a
AMBOS padres y todos los archivos sin seguimiento. Las pruebas del gate deben
demostrar que una infraccion nueva sigue siendo visible y que una ref no integrada
se rechaza. Esto valida la resolucion; no declara limpio el codigo heredado.
Registrar ambos alcances, OIDs y resultados en la evidencia. Typecheck, tests,
revision semantica de solapamientos, hooks y artefactos siguen siendo obligatorios.

## Registro por incidencia

En el informe de cada release guardar:

1. Sintoma y comando fallido, archivo/test exacto y revision.
2. Causa demostrada: conflicto textual, port perdido, fixture, entorno o upstream.
3. Precedente con commit cuando exista; "parecido" no es prueba de recurrencia.
4. Resolucion y contratos conservados, incluyendo host y versiones mezcladas.
5. Comando de regresion, resultado y alcance no cubierto.

Conservar fallos iniciales y reruns. No sustituirlos por un resumen verde ni
contar pruebas omitidas como verificadas.
