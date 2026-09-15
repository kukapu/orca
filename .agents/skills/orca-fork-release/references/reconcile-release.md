# Reconciliar una entrega incompleta

Usar cuando el codigo o binario existe pero faltan manifiesto, marker o registros.
Aplicar el contrato del repositorio; no inventar una fuente por el nombre de version.

## 1. Clasificar el hueco

| Situacion                                             | Accion                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Manifiesto durable valido, workspace retirado         | Recuperar y validar bytes/digests con `durableReleaseSource`; comprobar objetos Git.                                  |
| Marker terminado valido, falta manifiesto             | Verificar evidencia/artefactos y completar entrega autorizada; no repetir build si sus inputs siguen validos.         |
| Tag y codigo publicados, sin evidencia de gates       | Recuperar registros; si no existen, reconciliacion manual supervisada de la fuente. No marcar `prepared`/`published`. |
| Artefactos perdidos                                   | No inventar hashes. Para entregar esa version hace falta reconstruccion verificada e inventario de colisiones.        |
| Runtime sin automatizacion conocida                   | Descubrir host/entorno y metadata actuales. No crear otra automatizacion como arreglo implicito.                      |
| Preparacion activa/bloqueada o proceso `unverifiable` | Coordinar con su propietario; no arrebatar la reserva ni inferir `exited`.                                            |

## 2. Aceptacion manual de una base operativa

El usuario puede aceptar explicitamente una version que usa como base para el
siguiente trabajo. Registrar fecha, palabras/intencion y alcance en un documento
versionado. Esto permite reconciliar manualmente la **fuente**, sin fabricar una
entrega historica ni eliminar los gates del nuevo candidato.

Antes de usarla:

1. Inventariar el host propietario y las preparaciones existentes; resolver
   concurrencia o registros inaccesibles. Aceptacion de version no cancela trabajos.
2. Verificar sourceTag remoto/local y C peeled, tag/OID oficial anterior, ancestry,
   merge-base y delta del fork frente al corte estable. Confirmar que el arbol de
   la fuente no arrastra upstream posterior excluido por la politica estable.
3. Verificar P y sus dos padres ordenados C,F-anterior, igualdad de arbol C/P y
   ancestry hasta F-actual. Revisar diff/log de cambios posteriores y portarlos
   explicitamente; cambios desconocidos siguen bloqueando.
4. Registrar hechos comprobados, evidencia no recuperada y version en ejecucion
   como observada o comunicada por el usuario, segun corresponda. Nunca deducir
   hash del binario instalado a partir del tag o de `package.json`.
5. Con la revision Git completa y la aceptacion registrada, continuar manualmente
   desde C hacia el objetivo solicitado. No exigir reconstruir la release antigua
   solo para empezar la nueva. Verificar y documentar todos los gates de la nueva.

La aceptacion no cambia el precheck automatico: no crear un marker terminado ni
un manifiesto `published` sin artefactos reales validados. Mantener la automatizacion
bloqueada si su contrato exige evidencia que falta. La nueva entrega completa
proporcionara una fuente durable posterior, sujeta a validacion del precheck.

## 3. Cerrar la reconciliacion

- Guardar inventario Git, decision y lista de cambios a portar en el informe.
- Mantener separados "base aceptada", "fuente verificada" y "artefactos verificados".
- Si se completa la entrega anterior, subir su manifiesto solo tras verificar los
  assets reales y con autorizacion. No reemplazar tags ni adjuntar binarios nuevos
  como si fueran los antiguos.
- Si se continua con una nueva version, enlazar esta reconciliacion desde su informe.
  No volver a preguntar lo ya autorizado salvo contradiccion nueva concreta.
