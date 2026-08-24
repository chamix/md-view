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

## 2026-08-22 — Task 24: revelar y resaltar el archivo activo, y el cierre del sidebar en tres partes

Task 24 agrega lo último que le faltaba al sidebar del árbol: cuando el
archivo activo cambia (o el root del árbol cambia mientras un archivo ya
está abierto), el panel expande automáticamente las carpetas necesarias y
resalta la fila correspondiente con `.tree-row-active`. Mecánicamente es
una función nueva (`revealAndHighlight`), un helper puro (`isPathUnder`,
separador-consciente para no confundir `/foo/bar2` con hijo de `/foo/bar`),
y un token incremental que descarta el resultado de un walk asíncrono si
otro más nuevo ya lo superó mientras esperaba un `await`. Con esto se
cierra el plan de tres partes para el sidebar que arrancó en Task 21
(árbol perezoso con caché), siguió en Task 23 (resize) y termina acá —
vale la pena marcarlo explícitamente como el proyecto ya hizo con el
checkpoint de empaquetado de Task 13/14.

Lo no obvio: `establishTreeRoot` (Task 17/18) recalcula el root del árbol
como el directorio padre de *cualquier* archivo recién abierto, sin
excepción — tree-click, File>Open, drag-and-drop y argv pasan todos por
el mismo `renderAndWatch`. Eso significa que abrir un archivo nunca deja
ese archivo anidado más de un nivel bajo el root resultante: por
construcción, termina siendo hijo directo. El único camino real para que
el walk de auto-expand tenga que atravesar más de un nivel es el orden
inverso — un archivo ya está activo, y *después* Open Folder… apunta el
root a una carpeta ancestro (que nunca toca `activeFilePath`). Los tests
de este task (y la prueba FI-1 de la condición de carrera) están
construidos sobre esa secuencia específica, no sobre "abrir el archivo
anidado directamente", porque esa segunda opción, tal como está hecho hoy
el establecimiento del root, no produce el escenario multi-nivel que la
spec describe.

## 2026-08-22 — Task 25: another real-usage find the governed suite never surfaced

`REQUEST_OPEN_FILE` is the single shared entry point for both drag-and-drop
(`openDroppedFile`) and the tree panel's click-to-open (`openFileByPath`),
wired back in Task 16 and reused as-is by Task 21. Its listener has always
unconditionally routed whatever path arrived into `renderAndWatch` --
meaning a dropped *folder* fell straight into `renderFile`'s Markdown-only
check, which correctly rejected it, but as a document error ("Not a
Markdown file: <folder>") rather than being recognized as a valid alternate
input with its own valid, already-existing outcome ("Open Folder…"'s
`establishTreeRoot`, live since Task 17). Fixed with a single `fs.stat`
classification ahead of the existing dispatch: a directory now calls
`establishTreeRoot` and returns before any render/watch logic runs; a stat
failure falls through unchanged to today's `renderAndWatch` error path;
file behavior is otherwise byte-identical.

Worth naming plainly: this shipped through Tasks 16 (drag-and-drop's own
introduction), 17-18 (the tree-root/`establishTreeRoot` machinery this fix
now reuses), 20-21 (the tree panel that added a second real caller of the
same listener), and every review gate along the way -- nine tasks, all
green, all independently reviewed -- and the gap only surfaced on a manual,
packaged-app pass, dragging a real folder onto a running window. Same shape
as the Task 1-4 broken-image story: a fixture-scale e2e suite structurally
never drags a directory onto the window (every drag-drop fixture is a real
file, by construction, because that's what the feature was written to
handle), so no amount of re-running that suite could have caught this on
its own. Governance and adversarial review are real, necessary layers --

## 2026-08-23 — Task 26: viewport-fixed tree panel, and a spec snippet that silently reintroduced margin collapsing

`#tree-panel`/`#tree-resize-handle` switched from `flex: 0 0 auto` sizing
(borrowed from `#app-body`'s flex row, in turn driven by whichever sibling
was tallest) to `position: fixed; top: 0; left: 0/var(--tree-panel-width);
bottom: 2rem` -- a genuinely viewport-bound height, independent of both the
tree's own row count and `#main-panel`/`#document-container`'s Task-12
content-driven growth. `#main-panel` dropped its flex properties for
`margin-left: var(--tree-panel-width)`. Both `bottom` values reuse `body`'s
existing `padding-bottom: 2rem` status-bar clearance verbatim, per spec --
no new constant introduced.

The delegation's own snippet called for removing `#app-body`'s
`display: flex; flex-direction: row;` with "no replacement properties
needed." At the time I suspected that didn't hold up: a flex container is
also a block-formatting-context boundary, and I hypothesized that dropping
it would let rendered Markdown content's own top-margin (e.g. an opening
`<h1>`) collapse straight up through `#main-panel`/`#app-body` into `body`
-- a guardrail #51 regression (Task 12's content-driven layout must stay
completely unaffected). The guardrail #50/#51 tests did go RED with numbers
that didn't add up (a near-empty test document producing a 686px-tall page
in a 258px-tall test window), which read at the time as confirmation, so I
added `display: flow-root` on `#app-body` to restore the BFC boundary and
logged it as a proven fix.

Independent review (`.agents/specs/review_report_task26.md`, SF-1/SF-2)
didn't hold up that causal story: `#content` carries `markdown-body`, and
`github-markdown-css` already zeroes a `.markdown-body`'s first child's
top margin with `!important`, so there was no h1 margin available to
collapse in the first place. The reviewer reproduced the exact 686px/258px
figure with `flow-root` present and with it removed -- identical either
way -- and traced it to the narrow `#main-panel` forcing word-wrap on the
tree-many fixture text at that window size, the same confound I'd already
correctly diagnosed and worked around elsewhere for the guardrail #50
before/after-delta design, not margin collapsing. Full-suite screenshots
and scrollHeight/maxScrollY measurements came back identical with and
without the rule in every scenario tested. `display: flow-root` is kept
regardless -- it's a harmless, standard, zero-cost BFC idiom (unlike
`overflow: hidden`, it doesn't clip positioned/negative-margin content) --
but as defensive CSS, not as a demonstrated fix for a reproduced
regression. app.css's own comment at the point of change has been
corrected to match.

Required FI-1 proof (guardrail #52) run twice: once as the literal manual
edit the task assignment described (`bottom: 2rem` -> `bottom: 0` on both
elements in `app.css`, confirm RED — a real 31.2px overlap, exactly `2rem`
-- restore, confirm GREEN), and once as a permanent automated regression
test using a runtime-injected `<style>` override (`page.addStyleTag`) so
the same fault is re-provable on every future run without hand-editing
source. The first manual pass also surfaced a self-inflicted bug worth
naming: a `replace_all` revert of `bottom: 0;` back to `bottom: 2rem;`
collaterally rewrote `#status-bar`'s own unrelated `bottom: 0;` rule (it
matched the same literal string) to `2rem`, silently floating the status
bar 32px above the true window bottom. Caught immediately by the very next
test run going red for a different, larger (31.2px, then still 31.2px after
a "fix" that hadn't touched the real cause) discrepancy than expected --
fixed by a scoped, non-`replace_all` edit instead once isolated via a
direct computed-style dump of both elements.

Also caught and fixed before it shipped: the first draft of the guardrail
#50 (internal-scroll) test asserted an absolute `docScrollHeight <=
viewportHeight` bound after shrinking the test window to 480x320 and
expanding 40 tree rows. It failed even against the corrected CSS -- not
because the tree panel leaked into the page, but because a 480px-wide
window left `#main-panel`'s reading column so narrow that its own short
fixture paragraph word-wrapped into dozens of lines, legitimately growing
the page independent of the tree panel entirely. Rewritten to compare
`docScrollHeight` before vs. after expanding the tree (isolating exactly
what the tree panel's own overflow contributes) rather than asserting an
absolute threshold that any window/content combination could confound.

One more self-caught bug worth naming: the first draft of the "no folder
open" test forgot to override the file's default `electronArgs` (which
always opens a fixture file, and so always establishes a tree root) --
without an override, the test raced the async `FOLDER_TREE_ROOT` message
instead of genuinely exercising the permanent empty-state, so it passed or
failed depending on exactly when Playwright's assertion polled relative to
that message's arrival. Looked solid on the first few green runs; only
surfaced as a real, deterministic failure on a later re-run once the timing
happened to land the other way. Fixed with a nested `test.describe` +
`test.use({ electronArgs: [] })`, then re-ran the full spec file three
times back-to-back to confirm the flakiness was actually gone, not just
not-hit this time.

Full `tree-panel.spec.ts` (22 tests: Task 17/21 base + Task 23 + Task 24 +
new Task 26, all in one file per the task's "extend, don't fork" 
instruction) passes green, including Task 23's full drag-to-resize suite
run byte-for-byte unmodified (guardrail #53). Full e2e suite (63 tests
across every spec file) and unit/integration suites (96 + 19 tests) also
green. One test (`tree-panel.spec.ts`'s "clicking a file row" test) showed
its already-known flaky-under-parallel-workers behavior when run through
the repo's own post-edit test hook mid-session -- same previously-logged
baseline flake (Task 23's devlog entry), reproduced identically before this
task's edits and confirmed unrelated by running the full suite standalone,
where it passed cleanly both times.
neither is a substitute for someone actually using the built app.

**Corrección (2026-08-23):** el párrafo de arriba sobre `display: flow-root`
afirma un mecanismo específico (colapso del margen superior de un `<h1>`,
con las cifras 686px/258px como evidencia) que la revisión independiente de
Task 26 (`review_report_task26.md` §5) no pudo sostener empíricamente —
`github-markdown-css` ya neutraliza ese margen específico
(`.markdown-body>*:first-child{margin-top:0}`), y `#document-main`'s
`padding-top` bloquea cualquier colapso de todos modos, independientemente
de `flow-root`. Las cifras citadas resultaron ser un confound no
relacionado (word-wrap en una columna angosta), reproducible idéntico con
o sin `flow-root`. La línea se mantiene — es un guardrail de BFC sin costo
real, y no viola ningún guardrail mantenerla — pero como fix demostrado
para una regresión real, la narrativa original no se sostiene. Ningún
código de producción cambia por esta corrección, solo la explicación de
por qué existe esa línea.
## 2026-08-23 -- Task 27: "Up one level" -- closing point 6 of the manual-testing pass

Task 25's own devlog entry (2026-08-22) closed one gap from a manual,
packaged-app pass and explicitly left "navigate up"/breadcrumb noted as
out-of-scope for that task, not a new finding. Task 27 closes that gap:
a new row at the top of the tree panel (`.tree-row-up`, deliberately not
`.tree-node` so Task 24's `revealAndHighlight` sibling walk stays blind
to it) that re-roots the tree at `path.dirname(currentTreeRoot)` via a
new fire-and-forget `REQUEST_TREE_PARENT` IPC channel -- the same
message shape `openFileByPath` and the dropped-folder path already use,
result delivered through the pre-existing `FOLDER_TREE_ROOT` push,
never a new request/response round trip.

The interesting design constraint here was resisting the urge to write
a second "are we already at the top" check. `path.dirname()` already
returns its input unchanged when given an actual filesystem root
(`path.dirname('C:\\') === 'C:\\'`), and `establishTreeRoot` already
no-ops when the resolved candidate equals `currentTreeRoot` (Task 18) --
so the new main-process listener is a bare two-line pass-through with
no root-detection logic of its own. Verified directly: `establishTreeRoot`'s
body has zero diff in this task. The one guard the listener does need
(`if (!currentTreeRoot) return;`) covers a different case entirely --
no root ever established, avoiding `path.dirname(undefined)` -- not a
duplicate of the no-op check.

FI-1 required proving the no-guard design would actually fail without
`establishTreeRoot`'s existing no-op doing the work: temporarily calling
`establishTreeRoot(currentTreeRoot)` (same root, not the parent) instead
of `path.dirname(currentTreeRoot)` had to go RED. `electronApp.evaluate()`
can't reach the main process's module-level closures (no `require`/
`module` in that eval scope, re-confirmed empirically before writing the
test), so the fault was injected via `ipcMain`'s own public
`rawListeners()`/`removeAllListeners()`/`on()` API instead: capture the
real registered listener, swap in a no-op, confirm RED (0 events), swap
the real listener back, confirm GREEN. Exercises the actual production
listener object in both states, not a stand-in.

Independent review (`review_report_task27.md`) found no Blocking items
-- all six new guardrails (#54-59) held under direct inspection and
independently re-run tests (96 unit / 19 integration / 67 e2e, all
re-executed by the reviewer, not restated). Three non-blocking
Should-fix items surfaced: (1) this DEVLOG entry and the backlog note
above were missing from the engineer's delivery despite the approved
plan calling for both -- closed by the Lead after review, as recorded
here; (2) `tests/integration/preload-api-contract.test.ts`'s hand-written
`BridgeApi` literals don't include `requestTreeParent` (or, pre-existing,
`openFileByPath`) and that file sits outside both `tsconfig.json`'s
`include` and Vitest's type-checking, so the gap is silent -- logged to
`backlog.md` as its own pending item, out of this task's scope to fix;
(3) the engineer's flake report named two specific pre-existing-flake
tests the reviewer couldn't reproduce failing in two independent
full-suite runs (an unrelated test flaked once instead) -- the broader
"pre-existing, workers:1-clean, unrelated to this diff" conclusion held
up under the reviewer's own pre-Task-27 HEAD comparison, so this was
noted as an accuracy nit rather than escalated.

## 2026-08-24 -- Task 28: "Show File Tree" -- the first ViewSettings field with two independent write paths

`showTreePanel` joins `darkMode`/`showFrontmatter` as a third
`ViewSettings` field, but breaks an assumption both predecessors got
to rely on for free: every prior field only ever changed via its own
menu checkbox's click handler, so the menu template's `checked` value
(computed once, at `Menu.buildFromTemplate` time) never had a chance
to go stale. `showTreePanel` can also be forced `true` as a side effect
of an unrelated action -- `openFolderViaDialog()` and the directory
branch of the `REQUEST_OPEN_FILE` listener both already called
`establishTreeRoot` before this task existed; now they also call a new
`forceShowTreePanelAndRebuildMenu()` first, which forces the value and
-- this is the actually new part -- calls
`Menu.setApplicationMenu(Menu.buildFromTemplate(...))` a second time,
outside `app.whenReady()`, so the checkbox itself doesn't lie about
reality after the fact. Factored the handlers-object construction into
a single shared `applyMenu()` called from both the startup site and
this new one, rather than let two copies of the same handlers literal
exist and risk drifting.

The check-then-act guard (`if (viewSettings.showTreePanel) return;`)
is the one piece of logic this task actually adds; `establishTreeRoot`
itself has zero diff, same "extend by new caller, not by editing the
shared function" discipline this file's tree-root tasks (17/18/25/27)
have all followed.

Independent review (`review_report_task28.md`) found the implementation
itself correct on the first pass -- guard genuine, ordering correct
(force-before-`establishTreeRoot` at both call sites), Builder reused
without drift, `renderAndWatch` untouched -- but caught one real
Blocking gap: the approved spec explicitly called for a test proving
the guard's negative case (Open Folder while already visible must not
redundantly rebuild), and it was missing. Routed back for one
narrowly-scoped addition, scoped to `tests/e2e/tree-panel.spec.ts`
alone. The fix's strongest proof is a zero-broadcast-delta assertion
(`VIEW_SETTINGS` events received during the action) rather than an
end-state check, because `broadcastViewSettings()` and `applyMenu()`
sit behind the identical `if` in the identical function body -- a
zero-count assertion is logically tied to the guard short-circuiting,
not merely something that happens to look the same either way. Two
non-blocking should-fix items (coverage for the `REQUEST_OPEN_FILE`
directory branch specifically, and proving the Task 24 active-file
highlight survives a hide/show cycle) were folded into the same
follow-up since they touched the same file. Re-review confirmed all
three closed; 99 unit / 19 integration / 73 e2e all green, with one
isolated Windows parallel-worker crash on an unrelated pre-existing
Task 23 test, cleared by a clean re-run -- the same class of
environment flakiness this suite has hit before (Task 19, Task 27).

## 2026-08-24 -- Task 29: frameless main window, and a DPI-scaling side effect a native chrome had been silently absorbing

`frame: false` (scoped exactly to `createWindow()`'s own options, per
ADR-005 -- `defaultWindowOptions`/`windowConfig.ts` stayed untouched)
plus a custom `#title-bar` (drag region, three menu-label popups
reusing `buildMenuTemplate` a second time via a new `POPUP_MENU`
handler, three window-control buttons) replaced the main window's
native OS chrome. `menuHandlers()` was factored out of `applyMenu()`
so both the real application menu and the popup path build from one
shared handlers object -- no second, hand-duplicated menu description
(guardrail #67).

Two required empirical investigations, both run against the real
built app rather than assumed:

1. **Accelerators under `frame:false`.** CmdOrCtrl+O and F1, dispatched
   via `webContents.sendInputEvent` (the same technique already
   established in `help-menu.spec.ts` -- CDP-level `page.keyboard.press`
   does not reliably reach Electron's native accelerator table in this
   environment), both still reach their handlers unchanged. No
   regression.
2. **Double-click-to-maximize on the drag region.** Three independent
   techniques were tried against the real window: Playwright's own
   `dblclick`, `webContents.sendInputEvent` with an explicit
   `clickCount:2` pair, and a genuine OS-level double-click injected via
   a Win32 `mouse_event` call through PowerShell (real hardware-level
   input, not a CDP synthetic event). None observed the window
   transitioning to maximized -- the third technique additionally hit a
   DPI-scaling/multi-monitor coordinate-translation problem (Electron's
   `getBounds()` is in DIP, `SetCursorPos` wants physical pixels at this
   machine's 125% scale factor) that a diagnostic mousedown counter
   confirmed meant the click never reached the app's window at all. This
   is the same class of "cannot be reliably automated in this sandboxed
   environment" gap already documented for Task 16's physical
   drag-and-drop test -- not proof the documented Electron behavior is
   absent. Per guardrail #74's own conditional (no manual handler unless
   automatic behavior is *proven absent*), no manual double-click
   handler was added; `window-chrome.spec.ts` carries a light confirming
   test of the drag-region setup instead, with the investigation
   recorded in a code comment for the next reader.

FI-1 (guardrail #69: the maximize/restore button's state must track the
real OS fact regardless of trigger path) was executed for real, not
just asserted: the two `mainWindow.on('maximize'/'unmaximize', ...)`
listeners were commented out, the suite rebuilt, and the dedicated FI-1
test (`window-chrome.spec.ts` §f -- maximizing via a direct
`BrowserWindow.maximize()` call, not the custom button) went RED as
expected (button stayed un-classed after a real OS-level maximize);
restoring the two lines brought it back GREEN, confirmed on a full
rerun of the file (11/11 green).

One real, unplanned finding, not a flake: with `frame:false`
in place, this dev machine's 125% Windows display-scale factor produces
a DPI-rounding artifact right at the `minWidth: 480` boundary --
`BrowserWindow.setBounds({ width: 480 })` comes back as `482` (confirmed
via direct `getBounds()`/`getContentBounds()` probing, reproduced 5/5 in
isolated repeat runs). With the native frame previously in place, the
title bar's own chrome overhead pushed the resulting client width well
below 480 regardless of this rounding blip (Task 23's own devlog entry
already measured ~13px of native-chrome overhead at this same
boundary), so the artifact was invisible before -- removing the frame
removed the chrome padding that had been silently absorbing it.
`tests/e2e/tree-panel.spec.ts`'s Task 23 FI-2 proof (`dragging past the
dynamic max at a shrunk (480x640) window...`) asserts a strict
`window.innerWidth <= 480` immediately after that `setBounds` call and
now fails deterministically. That file was outside this task's granted
scope (`.agents/current_scope.json` did not include it), so it was not
edited -- flagged to the Lead as a genuine, reproducible conflict
between this task's mandated `frame: false` and a pre-existing test's
exact-boundary assumption, not routed around. Every other test in the
full suite (unit 99, integration 19, e2e 84 minus this one and two
already-documented pre-existing parallel-worker-contention flakes --
`tree-panel.spec.ts`'s Task 26 FI-1 hard crash, code `3221226505`, and
`window-chrome.spec.ts`'s own close-button test, both confirmed clean
5/5 and 1/1 respectively in isolation) passed.