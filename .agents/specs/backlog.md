## Backlog

- [Pending] Dark mode: github-markdown-css ya trae soporte vía prefers-color-scheme,
  pero la app no lo honra hoy (Windows en dark mode, la ventana renderiza
  claro igual). Requeriría wiring en el renderer para detectar/reaccionar
  al tema del OS. El theme de highlight.js elegido en Task 6 (github.css,
  claro) está pareado a como se ve la app HOY — si esto se resuelve más
  adelante, hay que revisar el pareo de themes de nuevo.
  
- [Pending] Flaky e2e: `live-reload.spec.ts`'s primer test ("live-reloads rendered
  content...") falló intermitentemente bajo carga de 4 workers en
  paralelo durante el review de Task 6 — reproducido como verde en dos
  reruns posteriores (aislado y en el suite completo). No es
  regresión de Task 6 (el diff de esa tarea no tocó nada relacionado a
  chokidar/watcher). Candidato: ampliar la ventana de polling del
  assert, o correr e2e con menos paralelismo. Sin prioridad urgente,
  solo flakiness bajo contención, no una falla determinística.