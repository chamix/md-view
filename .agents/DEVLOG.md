# Devlog

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