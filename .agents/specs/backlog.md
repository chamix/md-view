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

- [Pending] Task 7's `shouldSkipDevToolsShortcut` lives in `src/main/index.ts`
  and is unit-tested via a `globalThis.__mdViewDevToolsGuardForTests` bridge
  assigned unconditionally in every build (including packaged) — `index.ts`'s
  top-level `app.whenReady()` side effects make it unsafe to import directly
  into a Vitest unit test. Reviewer judged this non-exploitable (never bridged
  to the renderer via contextBridge) but flagged it as a spec-letter wrinkle.
  Cleaner fix than gating the assignment: extract `shouldSkipDevToolsShortcut`
  into its own leaf module (e.g. `src/main/devtools.ts`, no top-level Electron
  calls) — matching the existing `menu.ts`/`linkPolicy.ts`/`paths.ts` pattern —
  so a plain unit test can import it directly and the `globalThis` bridge is
  removed entirely rather than conditioned. Low priority, non-blocking.