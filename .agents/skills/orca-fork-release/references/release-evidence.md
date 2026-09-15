# Plantilla de evidencia de release

Copiar a `docs/releases/<version>-<fecha>.md` en el checkout asignado. Sustituir
placeholders con datos observados. No incluir secretos, pairing, IDs privados ni
rutas privadas en assets publicos. Guardar logs durables privados por separado.

## Objetivo y autorizacion

- Fecha / alcance solicitado:
- Integracion / commits / push / draft / release publica / instalacion autorizados:
- Workspace y host propietario (referencia privada si aplica):
- Reconciliacion previa y decision del usuario:

## Estado

| Etapa                        | Estado y evidencia |
| ---------------------------- | ------------------ |
| Inventario, reserva y fuente | Pendiente          |
| Integracion                  | Pendiente          |
| Gates de fuente C            | Pendiente          |
| Artefactos / smoke           | Pendiente          |
| Codigo / tag remotos         | Pendiente          |
| Draft / assets / manifiesto  | Pendiente          |
| Instalacion / version activa | No comprobada      |

## Procedencia Git

- Oficial anterior: tag / OID peeled:
- Fuente anterior: sourceTag / C / tree:
- Ultima publicacion LAST_P / padres / tree:
- F publicado capturado antes de integrar:
- Objetivo oficial: tag / OID peeled / estable publicada:
- Merge-base / revision de linaje estable:
- Candidato / version fork efectiva:
- Fuente nueva C / sourceTree / sourceTag:
- Publicacion nueva P / padres exactos C,F / tree:
- Verificaciones locales y remotas, con fecha:

## Preservacion del fork

| Cambio propio / commit origen | Destino o equivalente upstream | Evidencia / prueba |
| ----------------------------- | ------------------------------ | ------------------ |
| Por inventariar               | Pendiente                      | Pendiente          |

| Conflicto o solapamiento | Intencion de cada lado / resolucion | Regresion cubierta |
| ------------------------ | ----------------------------------- | ------------------ |
| Por revisar              | Pendiente                           | Pendiente          |

## Gates e inputs

| Gate                                                        | Comando exacto / base / entorno | C o hash de inputs | Exit / resultado / evidencia |
| ----------------------------------------------------------- | ------------------------------- | ------------------ | ---------------------------- |
| Typecheck                                                   | Pendiente                       | Pendiente          | Pendiente                    |
| Tests del delta y fork                                      | Pendiente                       | Pendiente          | Pendiente                    |
| Code quality con base explicita                             | Pendiente                       | Pendiente          | Pendiente                    |
| Contratos SSH/folder/wire/Windows/Git/proveedores afectados | Pendiente                       | Pendiente          | Pendiente                    |
| E2E / cloud segun delta                                     | Pendiente                       | Pendiente          | Pendiente                    |
| Build production / glibc / ASAR / CLI                       | Pendiente                       | Pendiente          | Pendiente                    |
| Smoke del artefacto / coexistencia                          | Pendiente                       | Pendiente          | Pendiente                    |

Registrar tambien hooks que cambien inputs, gates invalidados y razon de cada
repeticion. Omitido/no aplicable debe llevar justificacion; no cuenta como pase.

## Artefactos

| Nombre    | Bytes     | SHA-256   | Version efectiva | Verificacion remota |
| --------- | --------- | --------- | ---------------- | ------------------- |
| Pendiente | Pendiente | Pendiente | Pendiente        | Pendiente           |

## Marker Orca

Primera linea del comentario del workspace, conservando debajo el resumen previo:

```text
orca-release-preparation:{"upstreamTag":"<TAG_OFICIAL>","upstreamOid":"<OID_OFICIAL>","state":"preparing"}
```

En un bloqueo usar `state: "blocked"` y `reason`. Solo tras todos los gates y
artefactos pasar a `prepared`, anadiendo `forkVersion`, `sourceTag`, `sourceCommit`.
Anadir `publicationCommit` cuando exista P verificado. `published` exige entrega
remota y manifiesto completos. No crear estados nuevos para aceptacion operativa.

## Manifiesto durable

Crear `orca-release-provenance.json` como asset, no como sustituto del informe.
La siguiente estructura es una **plantilla no publicable** hasta reemplazarla con
datos reales y validarla con `config/scripts/upstream-release-provenance.mjs`:

```json
{
  "schemaVersion": 1,
  "repository": "kukapu/orca",
  "upstreamRepository": "stablyai/orca",
  "state": "published",
  "upstreamTag": "<TAG_OFICIAL>",
  "upstreamOid": "<OID_OFICIAL>",
  "forkVersion": "<VERSION_KUKAPU>",
  "sourceTag": "<TAG_KUKAPU>",
  "sourceCommit": "<C>",
  "publicationCommit": "<P>",
  "sourceTree": "<TREE_C>",
  "artifacts": [{ "name": "<ASSET>", "size": 0, "sha256": "<SHA256>" }]
}
```

Inventariar artefactos propios realmente subidos: binarios, metadata de actualizacion
y checksums. Sin autoreferencia al JSON. Maximo 64 KiB, 1-20 artefactos con nombres
unicos y size positivo segun validador actual. Calcular hash de bytes originales,
verificar digest/size del asset JSON y de los artefactos remotos. JSON parseable
no significa procedencia verificada.

## Entrega y recuperacion

- URL draft/release y OIDs remotos comprobados:
- Fuente durable recuperable sin metadata del workspace:
- Evidencia privada persistente / artefactos conservados:
- Etapa exacta pendiente y como retomarla sin repetir las anteriores:
- Destino de instalacion, autorizacion y ventana (si aplica):
- Backup consistente, rollback y comprobaciones postinstalacion (si aplica):
- Limites / cobertura no comprobada:
- Dia y fecha de ejecucion:
