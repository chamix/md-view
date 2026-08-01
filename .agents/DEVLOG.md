# Devlog

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