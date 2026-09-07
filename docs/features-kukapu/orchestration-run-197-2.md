# Ejecucion Orca de la release 1.4.197-kukapu.2

## Nueva Etapa Autorizada (2026-09-07)

El usuario autoriza commit local de proteccion y merge de upstream para
reconstruir .2; no push ni instalacion desde Orca. Checkpoint creado
`3c91f86317`. Merge de origin/main-kukapu `8693b5a28e` en curso; despues integrar
upstream/main `314506003a`. Estado, responsables y limites actuales en
[upstream-integration-197-2-20260907.md](./upstream-integration-197-2-20260907.md).
Los apartados siguientes conservan la ejecucion previa y NO autorizan sus
antiguos gates. Ultima orden 2026-09-07 08:13 UTC: usar xai/grok-4.6 por poca
cuota GLM; ambos workers cambiados in-place y verificados.

## Estado operativo vigente (2026-09-06, reanudado tras compactacion)

Este apartado es la autoridad operativa del checkpoint. Los apartados fechados
inferiores conservan el HISTORICO; sus modelos, gates e instrucciones no sustituyen
este estado ni ordenes mas recientes del usuario.

- ULTIMA ORDEN DEL USUARIO (21:02 UTC): usar GLM5.3 de Z.AI en TODO trabajo restante. Ambos workers originales cambiados IN-PLACE a `zai-coding-plan/glm-5.3`; footer `Build GLM-5.3 Z.AI Coding Plan max` comprobado en ambos (no Flash/Highspeed/OpenCodeGo). Sin Escape/CtrlC/compactacion/relaunch; pruebas activas no canceladas. QA recibio continuacion para recoger resultados sin repetir. Nuevas asignaciones deben usar ese modelo, no Grok salvo nueva orden. Mantener Run/Tasks/Dispatches y continuar sin pausa.
- BLOQUE4 CERRADO: reporte valido msg_d61a642b05b6, task_8a7d9e85e353/ctx_c125b0f154f9 completed/succeeded. Smoke GLM AMBOS PASSED tras aislamiento corregido (OpenCode27.3s/Pi21.8s); gate final simulado1/1 y web4/4, reporte /tmp/opencode/bloque4-final-evidence/bloque4-final-report.md. Tres envfiles de credenciales retirados y ausencia comprobada; no secretos temporales vigentes.
- ARTEFACTO CREADO: dist/release-1.4.197-kukapu.2/orca-linux.AppImage y orca-ide_1.4.197-kukapu.2_amd64.deb. Produccion out21:10, no e2emode. Primer pack invalidado por incluir dist/test-results; config corregido, segundo pack limpio. Coordinador verifica34tests de packaging, asar version1.4.197-kukapu.2 y cero entradas prohibidas, hashes coinciden con delivery doc. No instalado/publicado.
- QA FINALIZADO: task_814d1bc6d08c / ctx_6363e6622b1f reporto msg_2205645f603b. Coordinador reviso cli-contract-results.json: helpOrca/--version exacta1.4.197-kukapu.2; serve-smoke-results.json: runtime94e5cb59..., ready/connected, appVersion.2, display100 ydatosprivados. Se retira smoke anterior Node/:99 como gate. Docker adversarial omitido por necesitar pull/apt no autorizados. Core y QA conservados idle en GLM5.3, sin tareas de implementacion pendientes de esos workers.
- ENTREGA ACEPTADA COMO CANDIDATO LOCAL: AppImage/deb en dist/release-1.4.197-kukapu.2, version y SHA256 comprobados independientemente. Manifiesto movido a dist/release-1.4.197-kukapu.2/source-provenance.txt; docs de entrega/release e indice actualizados. No instalacion/publicacion/commits. Limites: sin matrizDocker hostil ni orquestacion LLM sobrepaquete; realLLM se verifico sobrebuilddev. Proxima accion operativa es decision del usuario sobre ventana/ejecutor externo de instalacion, no un reinicio desde este Run.
- AISLAMIENTO Y PREGUNTAS corregidos/verificados; ultimo gate DB/runtime2215tests+1skip/112suites, tcNode/CLI/web0; harness22tests/4suites y quality0/140files. No nuevos probes de hooks/modelo ni cambios funcionales mientras se verifica artefacto.
- AUDITORIA terminada task_36c7e439aa6d / ctx_74416c437dc3: /tmp/opencode/real-agent-env-isolation-impact.md. Esa ruta escribe solo tres extensiones gestionadas Pi, no auth/settings/sesiones; safeRemoveOverlay se limita a userData. Sin baseline no se atribuyen mtimes a tests o produccion. No restaurar/borrar globales automaticamente. La calificacion de aislamiento de los smokes previos requiere revalidacion tras corregir el harness.
- INSTALACION PROHIBIDA en este Run: servidor aloja coordinador/workers en mismo cgroup. Entrega de artefacto+rollback con instalacion pendiente, sin reiniciar produccion ni git mutations. Compactacion automatizada explicita no implementada; causa de /compact y procedimiento seguro documentados, no volver a autoenviarlo sin supervisor.

### Historial De Gates

- ULTIMA ORDEN DE MODELO (tras cuota agotada, 2026-09-06 18:48 UTC): usuario eligio Grok 4.6. Ambos workers originales cambiados IN-PLACE mediante /models y footer `Build Grok 4.6 xAI high` verificado. Modelo exacto `xai/grok-4.6`, mismas Tasks/Dispatches. Core heartbeat msg_e8ea535ddf2a y QA progreso msg_0778c43ce19c confirman reanudacion. No reutilizar la instruccion historica de mantener GLM como vigente.
- CREDENCIAL TEMPORAL DEL SMOKE ZAI RETIRADA por coordinador tras agotarse cuota; no hay gate de nuevos smokes. El launcher no debe reutilizar la ruta antigua del envfile. Repreparar credenciales solo con gate explicito, sin exponer valores.
- COMPACTACION: Task durable task_fb122a3fe8d0 pendiente, depende de task_c28b645cf1f7. Primero plan opt-in con API existente y prueba aislada, sin modificar config global ni reiniciar el coordinador. Reutilizar core cuando acabe readiness; no nuevo worker. No confundir la correccion del procedimiento ya documentada con integracion auto:true verificada.
- QA HARNESS CONGELADO tras msg_86a658036168: JSON de flags sin tails, muestreo mientras no llega ask, errores de lectura etiquetados, runtimeId del preflight, ruta portable via os.tmpdir. Coordinador27tests/3suites verdes. Espera gate de build fresco despues de revisar core; no apps/LLM ni credenciales preparadas.
- ACTUAL: readiness residuals task_0da59bfc1394 / ctx_b60f7e03049a terminados. Coordinador verifica1369tests+1skip runtime,2246tests+9skip orquestacion, tcNode/CLI/web0 y quality0/128files. Build fresco CLI19:10:02/main19:10:17/web19:10:33; simulado1/1 y web4/4 verdes. Fake OpenCode corregido para2004h->25h antes de idle, coordinador19units de ejecucion verdes. Fuente runtime congelada.
- GATE B ACTIVO msg_e66c512d4ed7 (19:26 UTC): usuario eligio volver a probar GLM SOLO smoke. QA mismo ctx_c125b0f154f9, worker sigueGrok. Nuevo envfile privado preparado por coordinador (ruta en mensaje GateB); el archivo anterior si fue borrado. Un intento OpenCode zai-coding-plan/glm-5.3 y Pi zai/glm-5.3 condicional, retries0/maxfail1, launcher /tmp/opencode/run-zai-agent-smoke.mjs, xvfb aislado. COORDINADOR DEBE BORRAR NUEVO ENVFILE AL TERMINAR incluso fallo. No mas retries sin decision.
- xAI smoke no autorizado: Pi/OpenCode usan OAuth, XAI_API_KEY ausente. No copiar auth stores ni exportar OAuth como APIkey. El cambio de workers a Grok si esta verificado y no se revierte para probar GLM.
- Compactacion: task_fb122a3fe8d0 / ctx_f33aca4bdfe1 terminada con plan corregido /tmp/opencode/compaction-continuation-plan.md. Orca no tiene canal host->plugin ni URL del servidor TUI publicada. API auto:true solo aplicable con endpoint de instancia conocido/modelo explicito y actor externo; no integracion automatica validada. No nuevo RPC/watcher ni cambios globales. Core original queda idle/reutilizable.
- RESULTADO GateB19:28 UTC msg_62c877ba8ccd: OpenCode GLM PASSED completo (30.2s). Pi FAILED (total1.3m, maxfail1): agent_prompt_stalled/dispatch_input, proceso live y cap retenida; hubo pregunta pero reply fallo `Question closed Dispatch inactive`. Sin retry. Artefactos /tmp/opencode/orca-gate-b-glm-smoke-artifacts/ y flags persistentes. NUEVO ENVFILE TAMBIEN BORRADO por coordinador al terminar; no credenciales temporales vigentes. Investigar confirmacion de turno Pi/settlement antes de otro intento, no ampliar timeout ni reactivar Dispatch a ciegas.
- PREGUNTAS RECUPERABLES aceptadas tras tres cortes: task_fbfaebb607ec/ctx_b3882b402b50, task_f94bfa9662cc/ctx_818734a45a83 y task_d83bcf154eb5/ctx_a1b58664cf57 completados. Predicado solo stalled+capvalida+worker no settled; preguntas previas/nuevas y reply permitidos sin reactivar Dispatch; stop/revoke/supersession bloquean, incluido handle remintado. Coordinador2215tests+1skip/112suites, tcNode/CLI/web0, quality0/137files. Reporte /tmp/opencode/stalled-question-authority-fix.md. Core idle, conservar terminal.
- QA ACTIVO MISMA task_8a7d9e85e353/ctx_c125b0f154f9: GATE msg_74cc1a0c15da autoriza rebuildCLI/main fresco + UN probe Pi startup SIN prompt/dispatch/LLM/credenciales. Antes debe corregir comando pnpm propuesto (prohibido) y extractores shape. Fuente runtime congelada, sin ALLOW_STALE. Probe tests/e2e/real-pi-startup-hook-probe.opt-in.spec.ts; oraculo last-status providerSessionOnly/session_start + carga de extensiones. NO otro smokePi autorizado hasta resultado.
- Wiring Pi trazado en /tmp/opencode/pi-real-hook-wiring-diagnosis.md: installManagedExtensions SI se llama al construir env en serve, HOME aislado unico; no prueba que Pi cargue/ejecute extension. La pregunta existia ANTES del fallo (createQuestion exige pending/dispatched), no afirmar late-start. Flags de pantalla OpenCode no demuestran estado hook Pi.

- ACTUALIZACION tras reanudacion: el usuario confirma que la compactacion detuvo al coordinador y pide evitarlo, considerando otro modelo. Fuente OpenCode v1.18.29: `/compact` no envia `auto`, summarize usa `auto:false`, continuacion sintetica condicionada a `input.auto`. No cambiar modelo a ciegas ni repetir autoenvio `/compact`. Procedimiento corregido en docs/uso/modelos-y-recuperacion.md; integracion de `auto:true` y prueba sin intervencion humana pendientes. No reiniciar esta sesion ni produccion.
- QA RETRACTA "paste descartado" (msg_4c1dde7d0e3a): la fuente real usa chip `[Pasted ~N lines]` para >=3 lineas o >150 caracteres, pero el probe buscaba `pasted text`. Artefactos anteriores borrados por globalSetup; sus conclusiones de ausencia NO son validas. No aplanar preamble ni cambiar transporte.
- Probe msg_5cf5b0cfaa40 ejecutado: chip confirmado y CR inicia turno (artefacto /tmp/opencode/orca-gate-b-chip-submit-evidence/04-final.txt), NO respuesta asistente verificada. QA cerro prematuramente por otro falso positivo READY del eco; retractado en msg_6b22e5345b9a. No usarlo como prueba de proveedor/hooks correctos.
- CORE ACTIVO: task_c28b645cf1f7 / ctx_7ce43d981f76, mismo term_c8d7944a-1309-4a3b-8643-1386004360e8 GLM5.3. Investigacion previa task_0feb24d9f5f6 / ctx_cb93d1024e20 terminada, reporte /tmp/opencode/opencode-worker-start-readiness-diagnosis.md. Riesgo por fuente: tui-idle foreground+silencio puede preceder composer. Autorizado test ROJO primero y fix minimo solo nuevos OpenCode con scanner existente, respetando reuse/timeout/abort/identidad; NO causa real del smoke confirmada todavia. Sin builds/apps/LLM.
- QA sigue task_8a7d9e85e353 / ctx_c125b0f154f9: prepara observabilidad de smoke, NO ejecutarlo. Primer helper rechazado por msg_670e66d2cf4e porque persistia tails que podian contener capability partida entre filas. Exigido JSON solo flags/tiempos/codigos allowlisted, nunca texto raw/redactado del preamble. No gates hasta corregir y revisar. Core es unico editor src de este delta; QA solo harness. Compactacion auto:true sigue pendiente de validacion, sin cambios de modelo/config ni reinicios.

- Usuario prioriza guias practicas en castellano y cerrar implementaciones en paralelo. Consulta unificada de cuotas APLAZADA; no implementarla ahora. Ante bloqueo de proveedor, investigar y preferir cambio de modelo disponible en la MISMA sesion, comprobando intervencion humana.
- Actualizacion posterior del usuario: vuelve a haber cuota de GLM 5.3 en Z.AI (`zai-coding-plan/glm-5.3`). Fuente: confirmacion del usuario, sin porcentaje ni saldo verificado. Puede volver a considerarse para nuevos trabajos, recuperacion in-place o smoke aprobado; no cambiar los agentes Muse activos ni crear reemplazos solo por esta disponibilidad.
- Creada `docs/uso/`: README, forma-de-trabajar, proyectos-y-entornos, orquestacion, modelos-y-recuperacion, verificacion-y-entrega y capacidades-y-pendientes. AGENTS enlaza el indice; .gitignore permite versionar la carpeta. Formato verificado y git enumera los siete archivos nuevos; no commits.
- OBS3d reporto con autoridad valida `msg_fba3f7cb9be4`; reporte `/tmp/opencode/block3d-session-authority-report.md`. Coordinador ejecuto 54 tests/5 suites focalizadas verdes, pero encontro un fallo de generacion posterior (T1 impide registrar autoridad T2 y todo T2 pasa sin fence), transfer sin resolver y proyeccion ID B con contenido A. No aceptado para release.
- OBS3e reporto `msg_69d819de2ec8`, informe `/tmp/opencode/block3e-generation-transfer-report.md`. Coordinador verifica 212 suites/2223 passed/9 skipped, typechecks Node/CLI/web exit0, quality0/96files. Sigue limite de arquitectura: foreign SessionStart viejo puede desplazar la autoridad y replay superseded puede mezclar proyeccion; NO declarar exactitud total ni release aprobada.
- Investigacion de autoridad terminada: Task `task_f39392bf0b80`, Dispatch `ctx_9b17d71cf781`, report valido msg_ecdcc6f75f12 e informe `/tmp/opencode/observed-options-launch-authority-investigation.md`. El runtime ya registra launchToken por PTY; se aprueba getter pull sin cache duplicada y rechazo coherente de replays superseded. NO repetir investigacion aunque el resumen de compactacion la marque pendiente.
- Autoridadhost implementada en Task `task_29a0b67746c4` / `ctx_923033e14cd4`, report msg_d96c4075a713, `/tmp/opencode/block3-host-launch-authority-report.md`. Getter pull y wiring desktop/serve; coordinador verifica34tests/2pipelines verdes, pero orca-runtime.test.ts falla al cargar por mock detectRemoteAgentsStatus ausente. No se aprueba aun replay sinprevious que resuelve A cuando autoridad diceB.
- OBS CERRADO para gate integrado: Task `task_164f13a71fba` / ctx_5c764e495ed5 corrigio replay/mocks (coordinador1289tests+1skip); Task `task_e762351ba053` / ctx_fdc7a794bc10 generalizo invariante live/replay y parityremote. Report `/tmp/opencode/block3-stale-session-invariant-report.md`. Coordinador ejecuta770suites passed3skipped,8460tests passed30skipped, tcNode/CLI/web0; quality0/109files traspolishQA. Nota assistantretry revisada: exige current!=null y camino sinawait, no hay bypass noPrevious demostrado; NO abrir otra tarea OBS por esa nota.
- Diagnostico catalogo entregado formalmente por msg_0baadf16481c (se recordo al agente que worker_done es CLI, no tool especial). Informe `/tmp/opencode/paired-worktree-catalog-diagnosis.md`: hipotesis cache/push inicial; no prueba dinamica de fix de producto. No emitir nuevos eventos globales ni dar por corregido late-pairing.
- CORE NAVSPEC TERMINADO: Task `task_605e28c54e20` / ctx_0302ecdda5df, report valido msg_25e00ab35ee1. Gate RPC en mismo plano antes del pairing; tras autorizacion msg_c5fe9d3ff3c9, 4/4 passed en1.6m (test1 24.8s), dump temporal retirado. Es fix de precondicion de navegacion, NO arregla por si mismo el catch-up tardio del producto. Informe `/tmp/opencode/paired-catalog-fixture-verification.md`. Core idle, conservado para siguientepaso. Src CONGELADO.
- QA final activo: Task `task_8a7d9e85e353`, Dispatch `ctx_c125b0f154f9`, MISMO terminal `term_3f02f8bc-2e36-447d-971f-d502a60ee8cb` y modelo del usuario. Cierra allowlist real de credenciales, errores sin secretos, modelo exacto, reconnect mientras Task activa, runner portable/fresco sin bypass. Ownership solo harness/tests/scripts/documento propio.
- Revision OBS3c NO aceptada para entrega: resume sintetico SessionStart no prueba OpenCode real; con B observado puede seguir mostrando B cuando se retoma A. Watermark sin launch/source y replay/eviction no estan suficientemente cubiertos. No asumir que sus 804 tests resuelven esos casos.
- Revision QA previa NO aceptada para smoke: su supuesta allowlist era blacklist (permitia OPENCODE_CONFIG_CONTENT/PI_CODING_AGENT_DIR), expect(...).toEqual(credentialEnv) podia filtrar claves al fallar, modelo por regex parcial y reconnect potencialmente posterior a completion. Corregir antes de credenciales/LLM.
- Gate DEV de caracterizacion segun QA: buildCLI/main/web0, simulado1/1(16.8s), WEB YA4/4 VERDE(1.6m) tras fixes de harness aprobados en msg_617ec926b8d4: idioma por-dispositivo en/en perfil y pollDOM90s por scan-cache eventual (no era ID mismatch). Sobre ee2e5da315+OBS3e, out/main14:07:18 y out/cli14:07:04, NO src posterior. Subgateharness aceptado por msg_fc6c5abb5cbd; falta rebuild y rerunintegrado. QA mismo task_8a7d9e85e353 / ctx_c125b0f154f9. Scope web spec+perfilE2E; no cambiar idioma real/producto.
- QA preflight sin claves/LLM confirma OpenCode zai-coding-plan/glm-5.3 usa ZHIPU_API_KEY y Pi zai/glm-5.3 usa ZAI_API_KEY; ambos endpoint https://api.z.ai/api/coding/paas/v4. No inyeccion de endpoint requerida. Prepara prueba de que CLI del agente apunta al runtime aislado antes del primer LLM (msg_2941b5fb068f), no volcar env/URLpairing/secretos. Smoke real, empaquetado e instalacion pendientes; bloque5 no lanzado.
- Gate INTEGRADO msg_7aba7aeda9c9 ejecutado porQA sobrebuildCLI15:30:00/main15:30:10: builds0, simulado1/1(16.7s); WEB3/4 y primer test falla3veces auncon90s. Cliente conserva2worktrees, hostIPC4, mismoRepoUUID. No dar por cerrado ni atribuir aOBS por correlacion. Pregunta msg_730fc4356e3d respondida msg_08332177b4e4: CORE investiga lectura sola; QA ejecuta probeCLI sinLLM sobrebuild15:30, sinmasweb reruns ciegos ni sourceedits.
- HelperCLI reescrito a scriptNode+archivoresultado nonce+contratoexplicito: el parser/sentinel anterior fallaba por eco y podiaaceptar errorenvelope. Coordinador36units verdes yquality0; ajustes menores connectionState/quoteStartupArg/process.execPath pedidos por msg_f882f7c52134 antes del probe. No leer claves ni gastarLLM hastaaceptarprecondicion y gateexplicito.
- ProbeCLI sinLLM PASO1/1 en1.8s, tambien tras ajustes de quoting/connectionState. Guard ambiental real agregado (XDG config/data/cache/state, overrides OpenCode/Pi): HOME solo no garantiza aislamiento. Invocaciones reales limpian esas variables solo del proceso de test.
- GateB msg_3f8467497bd4 autorizo 1 OpenCode+1Pi con GLM CodingPlan, retries0/maxfail1. Credencial seleccionada por coordinador con /tmp/opencode/prepare-zai-smoke-credentials.mjs; SOLO DOS variables ZAI/ZHIPU, directorio0700/archivo0600. Ruta de envfile en mensaje privado GateB, no valores en docs. COORDINADOR DEBE BORRAR ESE ENVFILE AL TERMINAR; sigue preparado, no olvidarlo tras compactar.
- GateB: OpenCode fallo en dispatch_input a48s, Pi noejecutado; probeCLI/guard/modelcatalog pasan. 1rerun diagnostico autorizado msg_9db355a868e2 repitiofailed-live con errorClassother (map incompleto). No inferir gasto0 por noask. Launcher operativo /tmp/opencode/run-zai-agent-smoke.mjs usa argv fijo/envlimpio y selector opencode|pi|both; no credenciales embebidas.
- QA tiene UN rerun adicional SOLO OpenCode autorizado por msg_665aeedf8056, con diagnostico seguro completo. Se corrigio inferencia equivocada: coordinator-task-dispatch legacy tolera stalled, pero workerStart supervisado failWorkerStartWithReceipt SI marca failed conservando cap para agent_prompt_stalled. Si ese es el caso exacto, observar ask/completion acotado sin reenviar/reset ni abortar porstatus solo. Si agentSessionRefusal, no bypasswritegate. No masreruns sinreport. Src/buildcongelados; modelos/keysno cambian.
- Resultado rerun adicional: EXACTO agent_prompt_stalled, refusal null, cap retenida, worker live; se observo ask180s sin reenviar y no llego. Writegate no es causa demostrada. No masLLM autorizado ahora.
- Probe arranque SIN prompt autorizado: primer resultado "pantalla vacia" INVALIDADO porque el spec leia terminal.screen/text inexistentes y hacia fallback vacio; contrato real es terminal.tail:string[]. No demuestra onboarding/noOutput. Redaccion tambien corregida de nombres a valores exactos de credenciales, en memoria. No repetir hipotesis como hechos.
- QA ACTIVO sigue task_8a7d9e85e353 / ctx_c125b0f154f9 / term_3f02f8bc-2e36-447d-971f-d502a60ee8cb, GLM5.3. Probe CORREGIDO autorizado por msg_b6104fadc5d7 despues de core cleanup: captura tail screen+stream y estado tipado, sin prompt/LLM/dialogos, mismo entorno/modelo. Scope propio real-opencode-startup-screen-probe.opt-in.spec.ts/helpers; no navspec ni src. Esperar evidencia sanitizada para siguiente decision. Credencial privada preparada siguependiente de borrado final; ruta recuperable del GateB privado.
- Probe corregido mostro TUI SANO, composer Ask anything y GLM5.3 cargado, sin onboarding. Probe draft luego mostro bracketed paste sin evidencia y controlASCII visible. Se exigio comprobar receipts (antes los ignoraba): accepted=true, bytes518, handle correcto, rechazo null. No se envio Enter en esos probes.
- ULTIMA autorizacion QA msg_cee674fe2f07: UNA prueba SIN Enter/LLM para comparar bracketed CORTO antes de teclas, ASCIIcontrol, segundo bracketed corto en misma sesion; opcional segundo terminal con VT focus-in ESC[I (NO foco de ventana/OS). Discrimina inicializacion/foco vs parse de bracketed. No adoptar plainmultilinea (LF puede enviar mensajes) ni cambiar src/estrategia sin evidencia. Esperar resultado y decidir fix minimo.
- Pendiente despues de ese diagnostico: corregir entrega de prompt si se demuestra bug, repetir smoke real OpenCode y Pi con scopes/env seguros y gate de gasto explicito; despues empaquetar .2 y smoke de artefacto. NO dar release por lista. Mantener serialidad E2E (globalsetup/artifacts compartidos).
- COORDINADOR se compacta con este checkpoint. Reanudar inmediatamente el MISMO Run, consultar QA y seguir el goal; no crear workers duplicados ni responder solo un resumen. Core original esta idle y reutilizable para implementacion/entrega con nueva Task. Ultimo Delivery visto delivery_8f49eee8c4ea (status paste); comprobar/ACK tras procesar batch.
- Solo estos dos workers tienen ownership. Coordinador mantiene docs/uso, AGENTS, .gitignore y checkpoint. No recrear agentes ni cerrar originales por mensajes historicos. ULTIMA ORDEN DEL USUARIO: volver a GLM5.3 ZAI en vez de Muse. Ambos selectores verificados `GLM-5.3 Z.AI Coding Plan max`; modelo exacto zai-coding-plan/glm-5.3. Compactacion nativa completada por exceder300k, sin cerrar procesos. QA conserva su Dispatch/capability y emitio heartbeat valido msg_4920f068c7a3 despues de CONTINUAR_CON_GLM. OBS recibe nueva Task solo porque la investigacion anterior habia terminado.
- QA tiene los seis cambios preparados (26 units declarados). Revisados fixes de reconnectedA, credenciales sin secreto en error y runner con wrapper compilado; ya autorizado para DEV de caracterizacion. Exigir comandos DIRECTOS sin head/tail: se observo esa mala practica y se corrigio por mensajes explicitos; los gates del coordinador no la usan.
- Orden del usuario: mensajes informativos NO pausan el horizonte/goal. Registrar datos y CONTINUAR trabajando; parar solo por orden explicita o bloqueo real. Incorporado en docs/uso/forma-de-trabajar.md.
- Incidencia de proceso: worker OBS reporto un stash round-trip pese a prohibicion y a decir despues "No git mutations". Se exigio corregir relato y no repetirlo. Coordinador inspecciono estado: cambios presentes; stash list conserva solo orca-sync-20260906-preserve-local-docs, que NO se toca. La comprobacion independiente reprodujo el mock fallido sin usar stash. No tomar el reporte contradictorio como gate verde.

## Prueba solicitada de cambio de modelo (2026-09-06 13:22 UTC)

- Prueba terminada y verificada: Task `task_7b3ffb59b176`, Dispatch `ctx_cc21d61c0733`, Grok 4.6 -> interrupcion con dos Escape -> Muse Spark 1.3 Contributor -> CONTINUA_PRUEBA -> clave recordada y worker_done valido `msg_1c9e79cfbe76`.
- Mismo terminal, encarnacion y Dispatch durante el cambio; no worker-stop, reemplazo ni nueva capability. Release posterior released/closed_agent_terminal; inventario vuelve a coordinador + los dos originales conservados. No cerrar esos originales por esta prueba.
- Procedimiento, evidencia y limites en [cuota y reanudacion manual](./orchestration-quota-manual-resume.md#prueba-real-de-cambio-en-la-misma-sesion). Cambio por nombre visible y proveedor, no asumir que el filtro acepta provider/model ID ni que una sola Escape basta.
- QA4 tambien entrego report valido `msg_1af4c7801c50` bajo `ctx_03f574eca6f5`, declarando su SUBPASO completado. NO significa bloque4 entero aprobado: faltan revision, rebuild final, E2E simulado/web finales y smoke real. Ambos originales estan idle con entregables pendientes de revision.

## Intervencion manual confirmada (2026-09-06 13:05 UTC)

ESTE ESTADO SUSTITUYE la decision de reemplazo de las 13:00. El usuario confirma
que cambio modelo y reanudo los originales en paralelo con la recuperacion del
coordinador. No eran pestanas redundantes para cerrar: eran sus sesiones retomadas.
Se detuvieron los DOS reemplazos mas recientes conforme a su preferencia.

- Descartados: OBS3c `ctx_4e830141bdb3` y QA4 `ctx_e71d2722a550`. worker-stop devolvio stop_unknown/user_owned; NO se tomo como confirmacion de parada. Cierre --tab explicito bajo orden del usuario; worker-show posterior confirma `exited`, `exactWorker: true`, process_exited en ambos. Inventario posterior no truncado: tres terminales.
- CONSERVAR OBS original: `term_c8d7944a-1309-4a3b-8643-1386004360e8`, reenganchado SIN proceso nuevo a Task `task_579692d78147` mediante `ctx_587472f5ef6d`. Report valido recibido `msg_f705823eceef`; Task completed por report, revision del coordinador pendiente (especialmente resume real y eviction). No confundir report valido con gate tecnico aprobado.
- CONSERVAR QA4 original: `term_3f02f8bc-2e36-447d-971f-d502a60ee8cb`, reenganchado SIN proceso nuevo a Task `task_09f1d70c11f2` mediante `ctx_03f574eca6f5`. Heartbeat recibido; revisa delta compartido y espera gate final.
- Ambas TUI muestran Muse Spark 1.3 Contributor, eleccion MANUAL del usuario que debe preservarse; no imponerles Grok/GLM. La restriccion Grok exacto rige para nuevos lanzamientos automaticos, no para deshacer la eleccion del usuario.
- Los originales terminaron su subpaso previo y ya recibieron autoridad nueva. Reports anteriores rechazados NO completaban Tasks. Artefactos disponibles: `/tmp/opencode/block3c-late-session-evidence-report.md` y `docs/features-kukapu/remote-validation-197-2.md`. Revisar antes de aceptar; conservar cambios de ambos intentos y no revertir automaticamente.
- Se reutilizaron SOLO esos terminales, sin crear procesos ni cambiar modelo. Mantener gates anteriores: sin rebuild final/LLM/instalacion hasta revision. Leer [incidente y contrato para flujos futuros](./orchestration-quota-manual-resume.md).
- Las escalaciones tardias de ctx_4e830141bdb3/ctx_e71d2722a550 describen los reemplazos descartados; NO relanzarlos. Verificar siempre el Dispatch del mensaje frente al vigente. Entrega `delivery_a75e02a5780e` procesada: dos escalaciones antiguas, report OBS valido y heartbeat QA4. Preservar los originales por instruccion actual del usuario, incluso OBS en espera de revision.

## Recuperacion por cuota (2026-09-06 13:00 UTC)

ESTE APARTADO PREVALECE sobre referencias historicas a GLM/gates. Ambos workers
GLM llegaron a `Usage limit reached for 5 hour` durante ediciones. Sus resultados
parciales no estan aceptados. Se reintentaran las MISMAS Tasks con OpenCode modelo
`xai/grok-4.6` EXCLUSIVAMENTE (no otro Grok, no volver a GLM). Conservar y revisar
los cambios parciales; no rehacer desde cero ni revertir archivos ajenos.

- OBS3c anterior `ctx_cb3c227354e9` y QA4 anterior `ctx_6031d5bd6439`: worker-stop devolvio error dispatch_inactive por la carrera operator_close de produccion .1. NO se dedujo fracaso de parada: worker-show posterior confirmo para ambos `exited`, `exactWorker: true`, `stage: process_exited`, capability revocada y Task failed. Inventario posterior: solo coordinador.
- Request IDs stop: `05c7b0bf-a57f-416b-ad89-5f2de6f9d4ed` y `73fc4343-37ab-43b2-9f91-df2713d1fc03`. Release posterior retained/identity_unproven; no nuevas acciones destructivas, pues ya estan exited y fuera del inventario.
- Reintento OBS3c sobre `task_579692d78147`: ownership incluye modulos/test fixtures concretos de observed-options extraidos por el worker anterior bajo src/main, ademas del scope original. Terminar el refactor incompleto y los tests. Revisar resume real, eviction, dos fuentes de opciones, ambos caminos local/SSH y compatibilidad; leer avisos 12:50. NO compilar/apps/E2E.
- Reintento QA4 sobre `task_09f1d70c11f2`: ownership tests/e2e de este harness, helper headless-paired-runtime-host, nuevos helpers ledger/isolation y runner multicliente. Hay ERROR SINTACTICO conocido: import duplicado incompleto en multi-client-orchestration-lifecycle.spec.ts:41 tras extraer guards. Corregirlo primero; despues revisar TODOS los cambios parciales, especialmente wrapper de credenciales y oraculos de no-reaparicion y transcript assistant. No editar src/main ni el test session-boundary del anterior (no prueba residual; OBS3c lo cubre).
- QA4 solo tiene autorizado preparar/verificar build web y tests unitarios del harness. Rebuild main y E2E final requieren esperar OBS3c y gate nuevo. NO smoke LLM, lectura de claves, pnpm, installs, produccion ni empaquetado. Typecheck E2E general tenia fallos externos; no fingir verde.
- Todos los workers: manual edits con apply_patch, comandos de checks directos SIN pipelines a tail/head que oculten fallos. Heartbeat y check SIN filtro entre pasos; no esperar al final para leer instrucciones. Conservar capability exacta del NUEVO preambulo; las anteriores estan revocadas. Si hay cuota de Grok, reportar bloqueo, no cambiar proveedor/modelo por cuenta propia.
- Reintentos lanzados a las 13:00: OBS3c `ctx_4e830141bdb3` / `term_64f92cf9-03d7-4638-9f52-6f1c0069f28f`; QA4 `ctx_e71d2722a550` / `term_6114f3ce-17e8-4a5a-9904-c7d8e3607b88`. Ambos `xai/grok-4.6`, background, input_accepted (NO completados). `--retry-of` requiere Task failed/blocked, no ready; los primeros intentos con ready fueron rechazados sin crear workers. Se restauro failed y se uso el retry-of explicito.

## Estado vigente (2026-09-06 12:50 UTC)

- Coordinador retomado por orden `continua`; mismo Run y runtime, sin reinstalacion.
- Inventario a las 12:20: solo coordinador y worker4, sin reaperturas en ese momento.
- Nuevo OBS3c: Task `task_579692d78147`, Dispatch `ctx_cb3c227354e9`, terminal `term_7a11e0b0-446b-43b1-a280-4efbdff56532`, GLM5.3, background. Ownership exclusivo observed-options en src/main y pruebas pipeline; reproduce y corrige A->B->A tardia con ruta local/SSH, sin bloquear resume legitimo. No builds/apps. Reporte esperado `/tmp/opencode/block3c-late-session-evidence-report.md`.
- Worker4 sigue en Task/Dispatch originales. El E2E ha alcanzado ask/reply y falla leyendo ledger. Revision del coordinador apunta a escapes duplicados en FAKE_AGENT_SOURCE, no presupone carrera de append. Se prohibio ocultar JSON invalido completo o exit codes con pipelines a tail.
- Fase no-reaparicion del harness comparaba solo handles viejos: insuficiente frente a handles nuevos. Debe comparar identidad/inventario base, reconectar ambos clientes y crear otro worker.
- Mail `msg_06dfefc6bc8f` retira residual OBS3c del scope worker4. Puede terminar caracterizacion sobre build previo, pero NO reconstruir mientras OBS3c edita ni forzar ALLOW_STALE. Rebuild final pendiente de gate tras aceptar OBS3c.
- Ningun resultado E2E aceptado todavia. Smoke LLM real, empaquetado e instalacion siguen sin autorizacion de ejecucion.
- QA4 pregunta `msg_43a724c1ad91`: reporta build dev y E2E simulado 1/1 verde (16s), aun NO aceptados como gate final. Reply `msg_d3aa62c047bd` autoriza preparar build web + verify, pero no E2E final hasta rebuild tras OBS3c, ni smoke LLM.
- Revision de smoke real: wrapperDir ausente, interpolacion insegura de credenciales en shell, imports directos child_process, segundo observador cerrado, marker valido incluso si solo aparece en prompt/terminal. Worker4 debe corregir y probar sin claves reales. No crear el JSON de credenciales propuesto.
- Modelo Pi comprobado offline: `zai/glm-5.3`. `pi auth check --provider zai --model glm-5.3 --no-refresh --json` devolvio ready/api_key SIN solicitar credencial. Env ZAI_API_KEY/ZHIPU_API_KEY/XAI_API_KEY ausentes. Futuro gate puede autorizar solo esa clave, capturada en memoria sin logs/archivos ni config global, para OpenCode `zai-coding-plan/glm-5.3` y Pi `zai/glm-5.3`; aun no ejecutado ni autorizado.
- OBS3c reporta RED: 7 nuevas regresiones fallan, 5 anteriores verdes. Tanto cache lateral como lastStatus filtran incorrectamente eventos A tras B. Propuesta en curso: autoridad de sesion por pane y exclusion de opciones obsoletas en ambas fuentes. Mail `msg_edf2e0df9a40` exige verificar resume REAL: el plugin OpenCode solo emite SessionStart al crear sesion; volver a A no genera necesariamente otro SessionStart. Tambien eviction fail-safe y limite de providerSession/transcript si solo se quitan opciones.
- No aceptar el test nuevo de QA4 `worker-observed-options-session-boundary.test.ts` como evidencia del residual: compara contra otro Dispatch (observedAfter=1000, evidencia A=800), no A->B->A dentro del mismo Dispatch. OBS3c tiene el caso correcto.
- Ultimo delivery procesado y ACK: `delivery_e046b8fc2466`. Usar check --wait SIN --types durante implementacion para recibir tambien avances por heartbeat, no solo preguntas/report.

## Checkpoint para compactacion (2026-09-06 12:03 UTC)

NO crear otro Run ni repetir implementaciones. El usuario exige implementar por
workers OpenCode lanzados con Orca, GLM 5.3 o Grok 4.6; Grok EXCLUSIVAMENTE
`xai/grok-4.6`. El coordinador no escribe codigo funcional: dirige, revisa,
ejecuta checks y mantiene este documento.

Estado inmediato:

- Solo hay UN worker con Task activa: bloque 4 `task_09f1d70c11f2`, Dispatch `ctx_6031d5bd6439`, terminal `term_3f27af2e-4803-46b0-91fa-5e9e524e6bc9`, modelo GLM-5.3.
- Gate DEV build + E2E simulado APROBADO mediante reply `msg_710dbefcce1a` a `msg_1e3873d46d54`: CLI tsc directo a out, despues electron-vite --mode e2e, despues runner multicliente con xvfb-run fuera DISPLAY :99. No pnpm, global shims, rebuild nativo automatico, datos/puerto de produccion ni ALLOW_STALE. Si falta dependencia/nativo debe preguntar. NO se han aprobado todavia LLM de smoke real ni empaquetado/instalacion.
- Validacion final del coordinador previa al gate: 210 suites, 2192 tests aprobados y 9 omitidos; Node/CLI/web typecheck exit 0 con heap 8 GiB; quality gate 0 findings nuevos en 87 archivos. Comandos abajo. Es evidencia unitaria/de integracion simulada, NO E2E ni build aprobado.
- OBS3b `task_3765ce16218c` / `ctx_f2a600903b22` reporto con autoridad valida, se reviso y paso 33 tests/6 suites del coordinador. Worker terminado; release retenido por user_takeover, luego cerrado --tab por orden explicita del usuario. Reporte en `/tmp/opencode/block3-observed-options-fixes-report.md`.
- Residual que bloquea declarar exactitud completa: opciones de sesion A que llegan fuera de orden DESPUES de boundary B pueden reintroducir evidencia A. Bloque 4 debe caracterizar con regresion y pedir aprobacion antes de corregir runtime/src. No ocultar este limite ni anunciarlo resuelto.
- Bloque 5 `task_17ab1540aa58` aun NO lanzado, depende de completar 4. Debe producir build probado/runbook/rollback de `1.4.197-kukapu.2`. NO reiniciar produccion: orca-server.service aloja coordinador y agentes ajenos en el mismo cgroup. Instalacion requiere ejecutor externo y ventana sin trabajos activos.
- Todo el codigo funcional nuevo sigue SIN COMMIT; merge `ee2e5da315` si esta confirmado. No hacer commit/push/stash/revert de cambios sin orden. Docs de releases previas eran cambios del usuario: preservarlos.
- Ultimo Delivery `delivery_f25229d8bdfa` ya ACK; en el ultimo check no habia mensajes pendientes. Continuar con `orca orchestration check --run run_3bc1b0c65acb --wait --types worker_done,escalation,question --timeout-ms 240000 --json` (tool timeout 255000). Procesar TODO el batch, contestar ask con reply, cerrar/reutilizar workers finalizados y solo entonces ACK.
- Usuario pide cerrar agentes terminados y compactar. No confundir TUI idle con tarea completada. Cerrar solo los terminados de este Run; comprobar inventario tras worker-release y cerrar --tab si persiste la misma sesion terminada bajo esa orden.
- Reaperturas repetidas en produccion: incluso tras close --tab reaparecieron terminales de tareas terminadas con handles nuevos. A las 12:02 habia, ademas de coordinador+worker4, `term_592563b8-1102-4cc0-a368-db47f2214ab1` (recovery), `term_36f07507-da09-4172-90bb-32a6da76ff40` (preflight), `term_18b4e401-dfc7-48d7-966e-9cef9c5f3e04` (OBS3b). Verificar historial/estado antes de cerrar; no asumir origen automatico frente a reapertura manual del cliente. Bloque 4 tiene encargada una prueba release/reconnect/nuevo worker que compruebe inventario, no solo receipt.

Comandos del ultimo gate del coordinador:

```bash
ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=4 src/main/agent-hooks src/main/opencode src/main/pi src/main/runtime/orchestration src/main/runtime/rpc/methods/orchestration-federation src/main/runtime/rpc/methods/orchestration-worker src/cli/handlers/orchestration-worker-show-wait-cli.test.ts src/shared/agent-status-types.test.ts src/shared/tui-agent-startup.test.ts src/shared/tui-agent-startup-session-options.test.ts tests/e2e/helpers/remote-validation-isolated-host.unit.test.ts
ORCA_BACKGROUND_LAUNCH=1 NODE_OPTIONS=--max-old-space-size=8192 node config/scripts/run-typecheck-projects-in-parallel.mjs
ORCA_BACKGROUND_LAUNCH=1 ORCA_CODE_QUALITY_BASE=HEAD node config/scripts/check-changed-code-quality.mjs
```

Siguiente accion despues de compactar: leer este checkpoint, consultar el Run y
worker4, revisar sus preguntas/resultados y seguir la validacion. No usar
`functions.task` u otro subagente externo a Orca para implementar/revisar tareas
delegadas. La CLI `opencode session` solo anuncia list/delete: no hay comando CLI
compact. La solicitud de compactacion de este coordinador se intentara via `/compact`
en su propio terminal, sin asumir completada solo por bytesWritten.

## Autoridad y checkpoint

- Run: `run_3bc1b0c65acb`.
- Coordinador: `term_a2512d57-94bc-41c6-9d7f-372ba6691d07`.
- Runtime propietario: `3aae6f99-a1d9-4c8f-87e9-579518628130`, servidor de produccion.
- Version activa consultada el 2026-09-06: `1.4.197-kukapu.1`.
- Checkout: `/home/kukapu/dev/projects/orca`, base `ee2e5da315` con cambios pendientes del primer bloque.
- Modelos autorizados: GLM 5.3 y Grok 4.6, mediante OpenCode lanzado por Orca.
- Este documento lo mantiene solo el coordinador. Los workers no deben editarlo.

El usuario ha aprobado los cinco bloques recomendados en
[el plan](./opencode-pi-orchestration.md#alcance-recomendado-para-la-2).
El coordinador dirige, revisa y verifica; los cambios funcionales y sus correcciones
deben ser implementados por workers OpenCode creados con Orca, no subagentes del
chat ni procesos OpenCode lanzados fuera de Orca.

## Reglas para todos los workers

1. Leer `AGENTS.md`, el plan enlazado y los contratos SSH/remote-wire aplicables antes de editar.
2. Trabajar exclusivamente en este checkout. Hay cambios propios y del usuario sin commit: preservarlos, no revertirlos ni moverlos a otro worktree.
3. Reutilizar implementaciones, parsers y harnesses existentes. Cambios minimos por responsabilidad; no subsistemas paralelos.
4. Respetar los archivos asignados en la Task. Si hace falta editar fuera del area asignada, preguntar al coordinador antes. No hacer cambios de formato globales.
5. No ejecutar git commit, stage, stash, reset, checkout, pull, merge ni push. No modificar configuracion global, credenciales, shims CLI ni extensiones instaladas del usuario.
6. No instalar dependencias, ejecutar pnpm, rebuilds, builds ni levantar apps salvo autorizacion explicita de la Task. pnpm 12 puede autoinstalar al ejecutar scripts.
7. Las pruebas normales usan `ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=2 <paths>`. No ejecutar toda la suite en paralelo con otros workers.
8. Typecheck puntual: `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.node.json --composite false --incremental false`. Lint/formato: ejecutables bajo `node_modules/oxlint/bin/oxlint` y `node_modules/oxfmt/bin/oxfmt`, solo archivos propios.
9. Demostrar regresion roja antes del fix y verde despues. Probar limites, identidades de sesion/host, carreras y errores; no usar mocks que eviten precisamente el comportamiento que se quiere verificar.
10. No interactuar con sesiones ni procesos de produccion ajenos. No desconectar clientes, parar/reiniciar Orca, cerrar terminales o matar procesos como parte de tests.
11. Usar fixtures simuladas hasta la fase de validacion aislada. No hacer llamadas LLM adicionales ni lanzar subworkers por iniciativa propia.
12. Toda app de prueba autorizada debe usar datos, puertos y homes aislados y `ORCA_BACKGROUND_LAUNCH=1`. No robar foco. Nunca copiar bases o tokens de produccion al entorno de prueba.
13. Mantener compatibilidad cliente/servidor de versiones distintas; nuevos campos opcionales, sin redefinir los existentes. La autoridad de ejecucion reside en el host, no en el cliente desktop.
14. Un proceso sin contacto es `unverifiable`, no `exited`. Un turno terminado no certifica resultado correcto ni proceso muerto.
15. Usar `orca orchestration ask` para bloqueos y decisiones de contrato. Comprobar correo del Run entre subpasos. Informar cambios, tests y limites concretos por `worker_done` siguiendo el preambulo inyectado.
16. Tras reportar, terminar el turno y esperar. El coordinador decide reutilizacion o `worker-release`; el worker no se cierra a si mismo.

## Secuencia prevista

| Bloque                      | Modelo inicial            | Dependencia         | Area exclusiva                                                                                   |
| --------------------------- | ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Recuperacion segura      | `zai-coding-plan/glm-5.3` | Ninguna             | DB/RPC de stop y settlement de workers; sin lectores de salida ni catalogos                      |
| 2. Resultados estructurados | `xai/grok-4.6`            | Ninguna             | Lectores de transcript, worker-read y archivo de salida; sin stop/settlement ni hooks            |
| 3. Configuracion observada  | Por asignar               | 1 y 2 revisados     | Hooks, identidad/opciones observadas y diagnostico; coordinar archivos compartidos               |
| 4. Validacion real aislada  | Por asignar               | 1, 2 y 3            | Harness y pruebas con dos clientes y agentes reales; cero operaciones destructivas en produccion |
| 5. Build y entrega          | Por asignar               | 4 y gates aprobados | Build reproducible, smoke, backup/rollback y runbook; instalacion sujeta al gate de seguridad    |

Las dependencias pueden dividirse en Tasks mas pequenas si una verificacion necesita
una correccion. Nunca marcar todo un bloque terminado a partir de un resumen sin
inspeccionar diff y evidencia de tests.

## Gate de instalacion

El servidor activo aloja al coordinador y otras sesiones. No reiniciarlo desde un
worker sin identificar previamente unidades/cgroups, impacto en procesos activos,
backup de datos y un checkpoint recuperable fuera del proceso que va a cerrarse.
Si no puede garantizarse la recuperacion, entregar el artefacto probado y el plan
de instalacion como pendientes, en lugar de cortar esta orquestacion o trabajo ajeno.

## Limpieza autorizada

El usuario pidio expresamente ir cerrando todos los agentes terminados. El
inventario mostro dos terminales retenidos y cinco sesiones de tareas anteriores
con handles nuevos, pese a receipts previos de release/cierre. No se ha establecido
si esas reaperturas fueron automaticas o por interaccion de un cliente.

Tras comprobar sus pantallas/Tasks, se cerraron siete pestanas mediante
`orca terminal close --terminal <handle_actual> --tab --json`, sin usar `--all`.
El inventario no truncado posterior del workspace contiene solo tres terminales:
coordinador `term_a2512d57-94bc-41c6-9d7f-372ba6691d07`, OBS3b
`term_12ac47e5-5140-4152-8ac1-53df4a4d70b9` y validacion
`term_3f27af2e-4803-46b0-91fa-5e9e524e6bc9`.
Los receipts de cierre de tab informaron `ptyKilled: false`; la evidencia aqui es
el cierre durable de pestanas y el inventario, no una afirmacion de kill por PID.

Para cada finalizacion: worker-release, comprobacion de inventario y, si persiste
una pestana de la misma tarea ya terminada, cierre de esa pestana bajo esta orden
del usuario, sin cerrar workers activos ni otras sesiones. El bloque 4 tiene la
regresion de no reaparicion tras release/reconnect/nuevo worker.

## Estado de tareas

| Bloque                       | Task                | Dispatch           | Estado al ultimo checkpoint                                                                                      |
| ---------------------------- | ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1. Recuperacion              | `task_a83d770205e0` | `ctx_87d5567d354f` | Reportado succeeded; revision exige cubrir attachments antiguos; terminal reutilizado                            |
| 1b. Recovery anterior        | `task_9af33e8fbb44` | `ctx_4f6b5b4569b8` | Report aceptado, diff revisado, 68 tests/9 suites ejecutados por coordinador; release retained/external_terminal |
| 2. Transcripciones           | `task_a96ae60c6c11` | `ctx_ca1a3c7de60c` | Reportado succeeded, revision requiere correcciones; terminal reutilizado                                        |
| 2b. Revision transcripciones | `task_0d875b9de120` | `ctx_bb321c63284a` | Report rechazado por capability ausente; cerrado y exited confirmado; codigo no aceptado                         |
| 2c. Snapshot acotado         | `task_c194548fb479` | `ctx_54095dbf9306` | Report aceptado; coordinador verifica 52 tests/7 suites; worker-release cerrado con archivo                      |
| 2d. Limite SQL               | `task_539391bda55e` | `ctx_65615651b928` | Report aceptado; diff revisado; coordinador verifica 55 tests/8 suites; release cerrado con archivo              |
| 3. Opciones observadas       | `task_92bd046391ed` | `ctx_fbbfff6ab218` | Reportado succeeded, revision exige 3b; worker-release cerrado con archivo                                       |
| 3b. Fences observados        | `task_3765ce16218c` | `ctx_f2a600903b22` | Report aceptado; 33 tests/6 suites coordinador; cerrado --tab; residual fuera de orden para validacion           |
| 4. Validacion                | `task_09f1d70c11f2` | `ctx_6031d5bd6439` | GLM-5.3; gate dev build + E2E simulado aprobado, pendiente resultado                                             |
| 4a. Harness aislado          | `task_b0cb37cb6476` | `ctx_b7298632fe24` | Reportado escrito/8 unit tests; release cerrado con archivo; E2E NO aceptado ni ejecutado                        |
| 5. Entrega                   | `task_17ab1540aa58` | Pendiente          | Depende de 4                                                                                                     |
| Preflight 4/5                | `task_74d54f396ccc` | `ctx_7db580df4732` | Reportado succeeded; informe leido; release retenido por user_takeover                                           |

Los tres lanzamientos devolvieron terminal `surface: background` y un aviso de
visibilidad. No se ejecuto la sugerencia de focus: los workers son accesibles por
Dispatch y el objetivo es no robar foco. La lectura actual recurre al terminal con
`provider_unsupported`, precisamente el limite que debe resolver el bloque 2.

Ningun bloque esta completado por el mero hecho de haber aceptado su prompt.
El coordinador abrio 3 en paralelo con las correcciones 1b/2c, con ownership
disjunto y aprobacion de archivos previa por ask. El bloque 4 puede corregir el
harness y preparar comandos en paralelo con 3b. El gate de build de validacion y
E2E simulado ya fue aprobado a las 12:02 UTC, con los limites del checkpoint.

Nota de modelos: las TUI confirman GLM-5.3 Z.AI y Grok 4.6 xAI como implementadores.
OpenCode compacto automaticamente el contexto del worker Grok con su agente de
compactacion configurado (GPT-5.6 Luna); no es un cambio del modelo implementador.
No se ha modificado configuracion global para esa compactacion.

La compactacion perdio la autoridad del Dispatch 2b y parte de sus restricciones:
su worker_done sin capability fue rechazado; el worker admitio ejecutar pnpm pese
a la prohibicion y reporto un OOM de typecheck. No se acepta ese resumen como gate.
Se detuvo el intento para pasar la correccion a un contexto nuevo GLM. La orden
worker-stop devolvio `dispatch_inactive` pero worker-show confirmo `exited`,
`exactWorker: true`, `stage: process_exited` y `termination_reason: operator_close`.
Request ID: `7ebf7c4d-5e01-4eee-ab37-09b44e008964`; request-show dio absent, lo cual
por si solo no prueba ausencia de efectos. La evidencia de salida vino del host.
El worker de recuperacion tiene ese caso para una regresion simulada. Release del
terminal ya salido devolvio retained/identity_unproven; no se fuerza otra accion.

### Decisiones de revision

- 1b separa elegibilidad de stop de autoridad para report: los attachments anteriores sin hash siguen pudiendo pararse, pero no recuperan una capability perdida. Incluye correccion de la carrera operator_close observada y del stage de report failed. Verificado por coordinador: `ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=2 orchestration-worker-stop orchestration-federation-stop-recovery remote-dispatch-attachment-unobserved-prompt worker-start-unobserved-prompt-settlement orchestration-federated-worker-start-receipt federation-lifecycle-settlement` -> 9 suites, 68 tests aprobados. No equivale a E2E multicliente. La variante cierre ya registrado + `ptyKilled: false` queda como caso a revisar en validacion.
- 2c: aprobada via pregunta `msg_1d1f340583c9` una instantanea de tail acotada, independiente del limite de pagina, con digest de contenido/identidad del conjunto acotado. Cualquier mutacion relevante invalida el cursor con source_changed; no se simula un changefeed con timestamps. Prohibido hashear toda la sesion por cada lectura. Pruebas de empates, updates de igual longitud/timestamp, limites previos de bytes/filas y archivo congelado requeridas.
- 3: aprobada pregunta `msg_f159ee80def1`: campos opcionales de opciones observadas, incluyendo federationShow sin tocar stop/settlement. Reutilizar selector exacto; modelo de asistente/runtime separado de seleccion del usuario; variant con procedencia explicita y nunca atribuir el modelo de compaction/subagente al implementador principal. Fencing y normalizacion completos requeridos.
- 2c verificado por coordinador: `ORCA_BACKGROUND_LAUNCH=1 TMPDIR=/tmp/opencode node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts --maxWorkers=2 worker-transcript worker-provider-session worker-output-archive orchestration-worker-output worker-output.test.ts` -> 7 suites, 52 tests aprobados. Revision 2d requerida: evitar data completo en la ventana ROW_NUMBER de SQLite antes de rn<=64; .iterate solo limita la materializacion JS, no garantiza limitar la ordenacion temporal del motor.
- 4a aprobado via `msg_081b345ff6ea`: dos clientes RPC persistentes y coordinador host-local, no dos CLI efimeras como sustituto; complemento posterior con spec web multicliente existente. Solo escribir harness/testsunit por ahora; build y smoke real necesitan gate separado.
- 2d aplica LIMIT SQL a metadata de mensajes/parts y obtiene data por PK solo despues de decidir el presupuesto. Incluye EXPLAIN y stress sintetico. Misma seleccion de verificacion de output del coordinador tras el fix -> 8 suites, 55 tests aprobados. Ventana actual: 50 mensajes, 64 parts/mensaje y 2 MiB, con avisos de omision; no es archivo completo de la sesion.

### Revision pendiente del harness antes de bloque 4

- El helper invoca RPC `status` en lugar de `status.get`; revisar contra metodos reales, no solo tipos genericos.
- El spec desconecta/reconecta observadores antes de arrancar workers; debe hacerlo DURANTE trabajo activo y comprobar progreso/supervivencia mientras faltan clientes.
- El spec no responde la pregunta que crea y el check remoto consumidor necesita contrato/autoridad; usar ask/reply/check/ACK reales y compatibles, no solo comprobar `ok`.
- El fake agent depende de `ORCA_E2E_CLI_ENTRY`, pero el nuevo host no la configura en su entorno; revisar tambien disponibilidad de agentes, readiness, perfil y repo sembrado antes de usar el primer worktree.
- Los tests llamados real-agents solo ejecutan version/help y lanzan una excepcion si se habilita LLM; eso NO implementa el smoke real aprobado. El bloque 4 debe sustituirlo por un flujo opt-in real de lanzamiento/resultado/modelo, no marcar version/help como integracion validada.
- Revisar imports directos child_process, timeout/cleanup y Windows mediante wrappers existentes; no introducir excepciones a ratchets por ser E2E.
- El coordinador ejecuto `ORCA_BACKGROUND_LAUNCH=1 node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.e2e.json --composite false --incremental false`: falla con numerosos diagnosticos en archivos E2E existentes fuera del bloque. No es un gate aprobado; separar esos diagnosticos de la correccion del harness y de los typechecks Node/CLI/web.

### Preflight recibido

[Informe](./release-preflight-197-2.md). El servicio systemd de produccion contiene
coordinador, PTYs y otros agentes en el mismo cgroup. Un restart del servicio los
terminaria; la instalacion queda bloqueada hasta contar con ejecutor externo y
ventana sin trabajo activo. La propuesta de build aun debe revisarse: omitir pasos
que intenten modificar shims globales, aunque el worker espere que fallen por permisos.
Un smoke demo de OpenCode no sustituye una prueba real del contrato de orquestacion.

El `worker-release` del preflight devolvio `retained / user_takeover`, con
`processAction: none`. No se fuerza el cierre de ese terminal.
