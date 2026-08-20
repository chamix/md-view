# Devlog

## 2026-08-20 — Task 23: tree panel drag-to-resize, and an assumption about setBounds that didn't hold

Shipped the `#tree-resize-handle` between `#tree-panel` and `#main-panel`
exactly per the approved reference implementation (clientX-as-width, live
`window.innerWidth`-derived max, document-level mousemove/mouseup lifecycle,
no persistence). No deviation from the spec's JS was needed or introduced.

One real finding during test-writing: the spec's own worked example assumed
`BrowserWindow.setBounds({ width: 480 })` yields `window.innerWidth === 480`
inside the renderer. On this machine it does not — the client area comes
back at 467px, ~13px short, presumably window-chrome overhead specific to
this Electron/Windows build. A test hard-coded to the nominal `480 - 300 =
180` clamp value failed for an environmental reason, not a logic bug.
Fixed by reading the live `innerWidth` after the resize and deriving the
expected clamp from that (same pattern the "default window size" test
already used), rather than assuming the nominal value — the resulting test
is more honest about what it's actually proving (live-recompute behavior,
guardrail #34) and isn't coupled to this machine's exact chrome overhead.

Both required fault injections were run for real, not just asserted:
- FI-1 (remove the `Math.min`/`Math.max` clamp): 3 tests went RED (the two
  clamp tests plus the shrunk-window test, which also depends on the
  clamp), 8 stayed GREEN, restore brought all 11 back to GREEN.
- FI-2 (hardcode `maxTreeWidth = 600` instead of deriving it from live
  `window.innerWidth`): confirmed directly (temporary diagnostic assertion,
  removed after) that `#main-panel` collapses to a computed width of `0px`
  at the 480px window size while `#tree-panel` claims the fixed `600px` —
  proving the fixed cap is unsafe exactly where guardrail #34 says it would
  be. Restore brought the suite back to GREEN.

Full `tree-panel.spec.ts` (Task 21 + Task 23, 11 tests) passes green. The
5-test flaky-under-parallel-workers baseline noted in Task 22's devlog
entry (file-tree.spec.ts x4, one tree-panel.spec.ts click test) reproduced
identically before, during, and after this task's edits when run as part of
the full suite via the repo's pre-commit hook — confirmed unrelated to this
change by running the affected files in isolation, where all pass.

## 2026-08-20 — La tentación de apurar, justo cuando el prototipo empieza a sentirse como un producto

A mitad de Task 22 surgieron preguntas operativas legítimas: ¿por qué
el reviewer vuelve a correr lo que el engineer ya corrió, si no hubo
cambios en el medio? ¿No se está poniendo pesado el ciclo de e2e? La
respuesta a la primera ya tenía precedente propio en este mismo
proyecto — el hallazgo S1 de Task 21 (el caso de carpeta vacía que el
suite entregado nunca cubrió) y el claim de casing de Task 20 nunca
reproducido por dos reviewers independientes en dos tareas distintas
— existen específicamente porque alguien re-verificó en vez de confiar
en el reporte. Re-leer no atrapa lo que el propio autor no vio para
empezar.

Pero hubo una segunda capa, más honesta, debajo de la pregunta: el
impulso de aligerar la verificación apareció en un momento muy
específico — justo cuando la app empezó a sentirse fluida, tangible,
"cerca de estar lista" — y casi se justificó solo. Nombrarlo tal cual
es lo que vale: no es un defecto de carácter, es la dinámica humana más
predecible que existe frente a un prototipo que empieza a andar.

Lo que lo frenó fue recordar el propósito real, doble, de este
proyecto: no es solo shippear md-view — es también material crudo para
comparar enfoques de desarrollo agéntico. Bajo ese propósito, la
verificación pesada por tarea no es overhead sobre "el entregable de
verdad" — es uno de los dos entregables. Aligerarla por velocidad no es
una optimización gratis, es un trade-off real contra un objetivo
explícito del proyecto, no contra nada.

Lo que salió de la conversación no fue "no cambiar nada" — apareció un
ajuste legítimo, ya presente a medias sin estar declarado: el peso de
la verificación debería escalar con el radio de impacto real del
cambio, no aplicarse parejo siempre. Tasks 17/18/20/22 (backend puro,
sin tocar el renderer compartido) nunca necesitaron correr el suite
completo siete veces — eso fue específicamente Task 21, porque tocó
layout compartido, exactamente la clase de cambio con blast radius
impredecible. Formalizar esa distinción es una mejora real, compatible
con el propósito doble, no una concesión a la impaciencia.

Vale la pena nombrar el paralelo: es la misma disciplina de "verificar
antes de asumir" que este proyecto ya viene aplicando a los subagentes
y a las propias afirmaciones del Lead (Task 8, Task 21) — aplicada una
vez más, esta vez al propio impulso de apurar, atrapado por quien lo
tuvo, no por otro.

## 2026-08-20 — Task 22: pollUntilStable resolvió el síntoma que midió, y destapó uno distinto

Task 21 había dejado un número concreto sobre la mesa: `marginLeft` de
`#document-container` se asienta en 230.8px, siete veces el umbral de
32px que el check (h) de `ui-shell.spec.ts` exige — el flake nunca fue
un problema de geometría, era leer el layout antes de que terminara de
asentarse tras un `waitForTimeout(100)` fijo. Esta tarea reconstruyó
ese diagnóstico descartable de Task 21 como un helper permanente y
reutilizable (`tests/e2e/support/pollUntilStable.ts`: sondea `read()`
hasta cinco lecturas consecutivas idénticas o lanza tras 5s), con
firma exacta dictada por la spec, cubierto por pruebas unitarias
deterministas en Vitest (incluida una inyección de falla real: se
introdujo temporalmente una lectura extra tras la convergencia, la
prueba de "no over-poll" se puso roja, se confirmó, se revirtió).

Lo que valió la pena no dar por cerrado sin verificar: correr la
prueba real requerida (`--repeat-each=20`, y el suite completo 5 veces
a `workers: 2`) no dio cero fallas. Un patrón nuevo apareció — no en
`marginLeft` (check g), sino en `containerBox.width` (check h),
recibiendo valores tan bajos como 126.4 en vez de >800. En vez de
asumir que era la misma clase de flake ya explicada, se escribió otro
diagnóstico descartable (mismo estilo que el de Task 21, borrado
después de usarlo) que trazó los bounds nativos de la ventana junto
al ancho computado del DOM cuadro a cuadro. Resultado: `getBounds()`
del proceso main reporta el nuevo tamaño (1600×900) de inmediato, pero
`window.innerWidth` del renderer puede quedarse hasta ~280ms atrás
bajo carga — y como ese valor viejo es perfectamente *estable* durante
ese tramo, `pollUntilStable` puede declarar convergencia sobre el
valor equivocado antes de que el resize real llegue al renderer. Es un
mecanismo distinto al que esta tarea targeteaba (un rezago de
IPC/message-pump del lado del renderer bajo contención de procesos
concurrentes, no un reflow de layout post-resize) — cae dentro del
ítem más amplio y todavía abierto de Task 19, no algo que el alcance
de esta tarea autorizara a arreglar (la firma de `pollUntilStable` y
ambos call-sites vienen dictados verbatim por la spec). Documentado
honestamente en `backlog.md` como hallazgo nuevo, no maquillado como
un pase limpio.

## 2026-08-20 — Task 21: el sidebar del árbol, y por qué la aritmética antes de asumir importa

Task 21 fue la primera pieza de UI real construida sobre el backend
del árbol de archivos que Task 17 dejó listo sin consumidor. Nada
sorprendente en el mecanismo en sí — un panel lateral, expansión
perezosa con caché por carpeta, click para abrir reusando el canal
IPC que ya existía. Lo interesante pasó en dos lugares donde el
proceso podría haber aceptado una explicación plausible sin verificarla,
y no lo hizo.

El primero: la técnica de prueba por fault-injection que la spec
proponía para el guardrail de caché (`require()` del módulo main ya
corriendo, desde adentro de `electronApp.evaluate()`, para interceptar
el handler real) simplemente no funcionaba en esta combinación de
Electron/Playwright — `require` y `module` no existen en ese contexto
de evaluación, que corre como eval global, no como cuerpo de un módulo
CommonJS. El engineer no forzó la técnica documentada a como diera
lugar ni inventó un mock; encontró que `ipcMain._invokeHandlers` (un
Map interno, no documentado) ya contiene el handler real registrado, y
lo usó para interceptar sin reemplazar la lógica de producción. Riesgo
real — un upgrade de Electron podría romper esto en silencio — pero
el reviewer lo verificó en vivo, confirmó que el handler capturado es
literalmente el mismo closure que corre en producción (no una
reimplementación), y hasta escribió una prueba descartable propia para
cubrir el caso de carpeta vacía que el suite entregado no ejercitaba.
Riesgo documentado en backlog, no ignorado ni bloqueante.

El segundo, más interesante: el engineer reportó honestamente que
agregar el sidebar parecía aumentar la tasa de flakiness de una
aserción ya conocida (`ui-shell.spec.ts`, `marginLeft > 32`, la misma
que Task 19 ya había dejado abierta y sin explicar). Antes de aceptar
esa correlación como causal, se hizo la aritmética: a 1600px de ancho
de ventana, `max-width: 54rem` del `#document-container` limita su
ancho a ~864px sin importar si el sidebar de 260px está presente o no
— el espacio disponible sobra en ambos casos por un margen enorme. Si
la geometría no cambia sustancialmente, la explicación más simple no
es "el sidebar rompió el layout", es "hay más tests en el suite ahora,
por lo tanto más procesos Electron compitiendo por recursos al mismo
tiempo" — exactamente el mecanismo de contención que Task 19 ya había
identificado como la causa más probable de la clase de fallas por
crash, sin resolver. El reviewer no se conformó con la aritmética
como argumento — escribió una prueba descartable que espera hasta que
el layout se asiente de verdad (polling en vez del `waitForTimeout(100)`
fijo del test original) y midió el valor real: `marginLeft` se
asienta en 230.8px, siete veces el umbral. La aritmética tenía razón,
y ahora hay un número real que lo respalda, no solo una conjetura.

Ninguno de los dos hallazgos bloqueó la entrega — ambos quedaron
documentados en backlog.md con la evidencia que los respalda, no como
afirmaciones sueltas. Lo que vale la pena registrar es el patrón: una
spec puede prescribir una técnica que resulta no funcionar en la
práctica, y un hallazgo puede parecer causal sin serlo — en ambos
casos, la respuesta correcta fue medir antes de aceptar, no descartar
la spec original ni la correlación reportada sin verificar primero.

## 2026-08-20 — Task 20: dos flakiness, dos causas, y por qué agruparlas era el error

Task 19 dejó una duda abierta a propósito: el fixture de aislamiento
por test no bajó la tasa de fallos del suite e2e, y entre las fallas
que seguían apareciendo estaba `file-tree.spec.ts`'s "Open Folder…" —
la misma prueba que backlog.md venía registrando desde Task 17 bajo la
etiqueta "contención de recursos en paralelo". Task 20 miró esa prueba
específica de cerca, línea por línea, en vez de asumir que compartía
causa con las demás.

La causa real no tenía nada que ver con cuántos procesos Electron
corrían en simultáneo. La prueba registraba su listener
`onFolderTreeRoot` con un `window.evaluate()` que devuelve una Promise
sin awaitear, y la línea siguiente disparaba, awaiteada, el click del
menú vía `electronApp.evaluate()` — un canal de automatización
distinto (el de Electron, no CDP). Nada garantizaba que el round-trip
del listener terminara antes que el del click. Si el click ganaba la
carrera, el broadcast de `FOLDER_TREE_ROOT` salía disparado hacia cero
listeners — los eventos IPC no se re-emiten — y la promesa colgada
nunca se resolvía. Timeout de 30s, y Playwright cerrando el target a
mitad del evaluate: exactamente la falla "Target page, context or
browser has been closed" que backlog.md venía anotando.

Lo que hizo el diagnóstico fácil de confirmar es que el mismo archivo
ya tenía el patrón correcto, cuatro veces. Otras cuatro pruebas en
`file-tree.spec.ts` ya registraban su listener con un `evaluate()`
awaiteado que acumula eventos en un array, y recién después disparaban
la acción — exactamente lo que un comentario en la línea 64 del mismo
archivo ya afirmaba que "Open Folder…" hacía, sin que fuera cierto. El
fix fue literalmente copiar el patrón que ya existía al lado, no
inventar uno nuevo.

La prueba no fue una sola inyección de falla — una carrera de timing
no se reproduce de forma confiable con un solo intento. Se usó
`--repeat-each=30` en su lugar, antes y después del fix, en ambos
`--workers=4` y `--workers=2`. El código roto falló 1 de 30 veces con
el engineer, y el reviewer reprodujo la misma tasa de forma
independiente (1 de 30, revirtiendo el fix a mano) antes de aceptar
que el arreglo lo resolvía — 30/30 limpio en ambas configuraciones de
concurrencia después.

Lo que vale la pena registrar es el error de encuadre en `backlog.md`,
no solo el bug. Cuatro entradas se habían escrito asumiendo que las
tres pruebas flaky (`live-reload`, `ui-shell:67`, `file-tree`'s "Open
Folder…") compartían una sola causa — "contención de recursos
compartidos bajo paralelismo" — porque las tres mostraban el mismo
síntoma superficial (timeout intermitente bajo carga). Task 19 ya
había sembrado la duda al mostrar que el fix de aislamiento no cambió
la tasa de fallos global. Task 20 confirma que al menos una de las
tres tenía una causa completamente distinta y local a su propio
código, sin relación alguna con cuántos workers corrían. Agrupar tres
síntomas parecidos bajo una sola hipótesis, sin verificar cada uno por
separado, es exactamente el tipo de atajo que este proyecto viene
evitando desde Task 4 — y esta vez el atajo ya estaba tomado en
`backlog.md` antes de que alguien lo cuestionara.

## 2026-08-20 — Task 19: una hipótesis bien especificada, probada con datos reales, y refutada

Cuatro entradas de backlog venían acumulando la misma sospecha: el
suite e2e es flaky bajo los 4 workers por defecto, y probablemente por
contención de recursos porque los 43 (en realidad 40, corregido al
grep) `electron.launch()` del suite comparten el mismo `userDataDir`
por defecto de Electron. La hipótesis era razonable, estaba bien
argumentada, y la decisión de arreglarla con un fixture nativo de
Playwright (`test.extend`, no un helper manual) ya estaba tomada antes
de escribir código, precisamente por la garantía de teardown que
Playwright ofrece incluso cuando un test explota a mitad de camino.

Se construyó el fixture, se migraron los 40 call sites, el reviewer
independiente lo aprobó sin bloqueantes (byte a byte contra el diseño
autoritativo, FI-1 reproducido de forma independiente: cero directorios
temporales huérfanos incluso con un test forzado a fallar). Todo el
proceso funcionó exactamente como debía.

Y el fix no cambió nada. Baseline: 8/12 corridas limpias, 4/12 con
fallo. Post-fix: 8/12 limpias, 4/12 con fallo. Mismo número exacto.
Peor todavía: las dos fallas de tipo crash de proceso (Windows
`code=3221226505`, un fastfail, no un timeout) que aparecieron en el
baseline sobre dos tests, reaparecieron post-fix sobre otros dos tests
completamente distintos — cuatro tests distintos en cuatro ocurrencias
a lo largo de 24 corridas totales. Si la causa fuera contención por
perfil compartido, aislar el perfil debería haber parado esto. Que
siga cayendo en un test al azar, ya aislado el perfil, apunta más bien
a presión de recursos crudos (CPU/memoria/handles) de correr 4 procesos
Electron/Chromium completos en simultáneo en esta máquina — algo que el
aislamiento de `userDataDir` nunca podía tocar.

Nada de esto se guardó silenciosamente. La spec (Step 1) ya declaraba
que la comparación de 12 corridas era la evidencia primaria, no una
formalidad, y que un resultado sin mejora significaba parar y reportar
en vez de adivinar una segunda hipótesis (bajar `workers`, agregar
delays). Eso es exactamente lo que pasó: se reportó el hallazgo
completo al usuario, incluyendo que la falla dominante seguía sin
explicación, y se dejó la decisión de cómo seguir en sus manos en vez
de escalar por cuenta propia. El fixture se queda igual — es una
mejora real de por sí (DRY, teardown garantizado, sin duplicar
`childEnv` catorce veces) — pero las tres entradas de backlog siguen
`[Pending]`, no `[Resolved]`, porque la causa real de la flakiness
sigue sin identificarse.

## 2026-08-20 — Task 18: dos APIs de realpath, probadas antes de elegir, no asumidas

`establishTreeRoot` (Task 17) comparaba raíces de árbol por igualdad
cruda de string. En un filesystem case-insensitive —Windows, esta
máquina de desarrollo, y también macOS/APFS por default— la misma
carpeta real puede llegar como dos strings distintos según cómo se
abrió: el casing que devuelve `dialog.showOpenDialog` no es
necesariamente el mismo que produce `path.dirname()` sobre un archivo
abierto por drag-and-drop o argv. El guard fallaba en reconocerlos como
la misma raíz, causando un re-listado y re-broadcast espurio de
`FOLDER_TREE_ROOT` — un usuario real podía dispararlo con solo abrir un
archivo de dos maneras distintas desde la misma carpeta. El gap estaba
ausente de la spec de Task 17, de la implementación, y de las dos
rondas de revisión independiente; solo apareció al investigarlo
explícitamente para esta tarea.

La resolución en sí es de una línea (`fs.realpath` antes de comparar/
guardar/emitir, con fallback al path crudo si la canonicalización
falla). Lo que vale la pena registrar es el paso previo: existen dos
APIs de Node para esto, `fs.promises.realpath` y `fs.realpath.native`
(esta última solo por callback, sin variante `fs.promises` documentada),
y no están garantizadas intercambiables respecto a preservación de
casing en Windows entre versiones de Node. En vez de asumir cuál
"debería" funcionar, el engineer corrió un probe descartable
comparando ambas contra un path real en mayúsculas — ambas devolvieron
el casing correcto en esta máquina (Node v24.15.0) — y el reviewer
reprodujo el mismo probe de forma independiente antes de aceptar la
elección. Se optó por `fs.promises.realpath` por no requerir el
wrapping extra de `util.promisify`, no porque fuera la única opción
válida. Misma disciplina que la confirmación de `removeMenu()` en Task
15 y el chequeo de existencia de los CSS de tema en Task 6: verificar
en la máquina real antes de comprometerse, no confiar en qué API
"suena" correcta.

Un solo ciclo RGR, verde a la primera. FI-5 (revertir el fix, confirmar
RED con dos broadcasts de casing distinto, restaurar, confirmar GREEN)
reproducido de forma independiente por el reviewer desde cero, no solo
leído del reporte del engineer. `renderAndWatch`/`openFolderViaDialog`
quedaron con diff cero — la resolución vive enteramente adentro de
`establishTreeRoot`, tal como pedía la spec.

## 2026-08-20 — Task 17: la primera IPC de pedido-respuesta, y el guardrail que un test no cubría

Hasta esta tarea, cada cruce IPC de md-view —en cualquier dirección—
era fire-and-forget: `ipcMain.on`/`ipcRenderer.send` para
`FILE_RENDERED`/`VIEW_SETTINGS` (main→renderer, desde Task 1) y para
`REQUEST_OPEN_FILE` (renderer→main, Task 16). Listar una carpeta no
encaja en esa forma: quien llama necesita el resultado de vuelta, no un
broadcast posterior. `listDirectory` introduce `ipcRenderer.invoke`/
`ipcMain.handle` como un segundo patrón de primera clase, no como un
reemplazo del existente — confirmado con un grep sobre todo `src/` que
`REQUEST_LIST_DIRECTORY` es, en efecto, la única ocurrencia del patrón
en el código hoy. `BridgeApi` sigue siendo el único punto de cruce
sin importar qué transporte use un método por debajo; esto no cambia
la dirección de dependencia que ADR-001 ya fijó, solo agrega una
tercera forma mecánica de cruzarla.

Lo más interesante de esta tarea no fue el patrón nuevo en sí, sino un
guardrail que casi queda sin cubrir. La especificación pide
explícitamente que `establishTreeRoot` se llame incluso cuando el
render falla — "un render fallido igual tiene un directorio contenedor
real que vale la pena tratar como raíz del árbol"— y el código lo
implementa correctamente desde la primera entrega (la llamada vive
fuera del bloque `if (message.ok)` en `renderAndWatch`). Pero ningún
test lo probaba: nada abría un archivo inexistente o no-`.md` y
verificaba que `FOLDER_TREE_ROOT` igual se emitiera. Un refactor futuro
que moviera esa llamada adentro del `if (message.ok)` habría
regresionado esto en silencio, sin que ningún test lo detectara — el
mismo patrón de falla que este proyecto viene documentando desde las
Tasks 2, 3 y 10 (el guardrail está bien implementado, pero
indocumentado por un test). El reviewer lo encontró en la revisión
independiente (finding S2, no bloqueante), el Lead decidió cerrarlo
antes de la entrega en lugar de dejarlo en el backlog dado el bajo
costo, y el engineer agregó el caso e2e faltante con su propia prueba
de fault-injection: mover la llamada de vuelta adentro del `if
(message.ok)` produjo un RED real (timeout esperando un evento que
nunca llegó), confirmado independientemente por el mismo reviewer desde
cero antes de cerrar la tarea.

Nota aparte sobre una afirmación de precedente que no se sostuvo: el
plan técnico de esta tarea decía que un DEVLOG de "primera vez" para
IPC ya existía para Task 16 (primer cruce renderer→main). El reviewer
verificó `git log -- .agents/DEVLOG.md` y esa entrada nunca se escribió
— esta es, de hecho, la primera entrada de DEVLOG desde Task 14. Vale
la pena recordar: una afirmación de precedente en una spec es una
afirmación verificable, no un hecho asumido, incluso cuando la escribe
el propio Lead.

## 2026-08-15 — Task 14: por qué la ventana de Help no tiene BridgeApi

Decisión deliberada, no un descuido: la ventana de Help no recibe
`preload` en absoluto (ni `window.mdview`), porque es contenido
estático app-authored sin necesidad de cruzar la frontera main↔renderer
para nada — más estricta que la ventana principal a propósito, no una
versión recortada de ella.

## 2026-08-08 — La hipótesis que estaba en el backlog, y estaba mal

Task 8 dejó una hipótesis anotada en el backlog: el texto se veía negro
sobre fondo oscuro en Dark Mode porque el link `.disabled` del stylesheet
claro no se estaba desactivando, o porque el orden/especificidad dejaba
ganar su regla de color por sobre la del oscuro. Sonaba razonable. Estaba
mal.

La causa real no tenía nada que ver con specificity: Chromium no hace
fetch de un `<link rel="stylesheet" disabled>` hasta que se habilita — así
que los dos stylesheets oscuros nunca se descargaban al arrancar. Para
cuando alguien abría un archivo y prendía Dark Mode, el `<base href>`
dinámico de Task 4 (pensado para resolver imágenes relativas del
contenido) ya apuntaba a la carpeta del archivo abierto, no a
`dist/renderer/`. El navegador buscaba `./github-markdown-dark.css` en el
lugar equivocado, 404, y el texto caía al negro por defecto del browser —
dos features de tareas distintas, cada una correcta por separado,
interactuando mal.

Lo interesante no es solo que la hipótesis original estuviera mal — es
que el primer intento de diagnosticarlo en esta misma sesión también
falló, y por una razón parecida: un test rápido que togglaba Dark Mode
antes de esperar a que el archivo terminara de renderizar, así que el
`<base href>` todavía no se había movido. "No se reproduce" fue un falso
negativo, no una conclusión. Recién con el mismo archivo real, esperando
el render completo, e inspeccionando el DOM en vivo, apareció el
`net::ERR_FILE_NOT_FOUND` real — la misma disciplina de "no asumas la
causa, verificá" que este proyecto ya venía aplicando a los subagentes,
aplicada ahora al propio Lead, con el mismo resultado: corrigió una
lectura apurada antes de que se convirtiera en un fix equivocado.

Fix: los cuatro hrefs de tema se resuelven a URLs absolutas una sola vez,
capturadas antes de que exista la posibilidad de abrir un archivo —
inmune a cualquier cambio futuro de `<base href>`. El reviewer reprodujo
la prueba de fault-injection en tres variantes aisladas antes de aceptar
el fix. Segunda vez consecutiva con Pass en el primer intento (Task 8 →
Task 9).

## 2026-08-01 — El primer ciclo completo, y lo que un click encontró que el CI no vio

Cuatro tareas gobernadas (Task 1 a 4), 32 tests en verde, reviews
independientes con fault-injection real — y el primer bug que un usuario
real encontró en la app real fue algo que ninguno de esos tests estaba
mirando: una imagen rota.

No fue un fallo de proceso. Los fixtures de e2e de Task 2 y Task 3 nunca
tuvieron imágenes — nadie pensó en probarlo porque nadie estaba mirando
la app, estaba mirando aserciones. Recién cuando empaqueté el `.exe` de
verdad, lo instalé, y abrí un archivo `.md` mío real (con una imagen
real, referenciada con ruta relativa, como cualquier nota normal) — ahí
apareció. El navegador resolvía la ruta relativa contra la carpeta del
`index.html` empaquetado, no contra la carpeta del archivo que estaba
abriendo. Bug real, invisible a 32/32 tests en verde.

Lo interesante no es que hubiera un bug — es *qué clase* de bug era.
Automatizamos disciplinadamente scope, testing, review adversarial con
fault-injection... y aun así hizo falta un humano haciendo clic para
encontrarlo. La gobernanza no reemplaza el uso real; lo complementa. Cada
capa atrapa una clase distinta de falla.

El fix (Task 4) trajo su propia vuelta de tuerca. El guardrail que
protegía el orden correcto de dos líneas de código —`base.href` antes que
`innerHTML`— resultó ser **estructuralmente imposible de probar a nivel
e2e** en este runtime de Electron/Chromium: el fetch de la imagen dispara
en un tick posterior al bloque síncrono que las contiene, así que para
cuando cualquier cosa es observable desde afuera, el orden ya no importa
— el resultado final es idéntico esté bien o mal. El reviewer lo probó
invirtiendo las líneas a propósito y corriendo el test cuatro veces: pasó
las cuatro, con el bug adentro. Dos técnicas de e2e distintas, mismo
punto ciego. La solución no fue escribir un mejor test e2e — fue bajar
un nivel, extraer la secuencia a una función pura, y probar el *orden de
llamadas* directamente, sin pasar por un navegador real. Un buen
recordatorio de que no todo bug vive en el nivel donde uno intuitivamente
va a buscarlo.

Cerré el loop hoy: `npm run package`, instalé el `.exe` sin firmar
(SmartScreen se quejó, como se esperaba), y esa misma imagen que se
rompía en la primera vuelta de testing exploratorio ahora carga bien.
Primer checkpoint real de "usuario final" para md-view, de punta a punta.

## 2026-08-15 — El fault-injection que sí encontró algo

Task 13 (ícono de la app en dev) traía un check de fault-injection
casi de rutina: renombrar `build/icon.png`, empaquetar, confirmar que
aparece el warning "application icon is not set" de electron-builder,
restaurar, confirmar que desaparece. El brief lo describía como algo
que "ya debería pasar" — no para probar código nuevo, sino para
detectar un typo de directorio. Bajé las expectativas en consecuencia.

No apareció ningún warning, ni con el ícono ni sin él. Empaqueté los
dos casos (`electron-builder --dir --win`) y comparé el `.exe`
resultante por SHA-256: idéntico byte a byte. El ícono nunca se
estaba embebiendo, con o sin `build/icon.png` presente.

La causa: la convención de electron-builder para el target win32 pide
`build/icon.ico`, no `.png`. `build/` solo tenía el set de PNGs (que sí
cubre macOS/Linux), nunca un `.ico`. El supuesto del brief —
"packaging ya funciona por convención, no hace falta tocar
electron-builder.yml" — era cierto para el copy step de dev-mode
(alcance real de esta tarea) pero falso para el build empaquetado de
Windows, que quedaba fuera de alcance y por lo tanto nunca se había
verificado con un build real hasta hoy.

Nada de esto formaba parte del diff de Task 13 — el ícono empaquetado
estaba explícitamente fuera de alcance, así que quedó anotado en el
backlog en vez de arreglado. Lo que vale la pena registrar es que el
check "de rutina" cumplió exactamente la función para la que estaba
pensado: no asumir que un precondition declarado en el brief es
cierto solo porque suena razonable, verificarlo con una corrida real.