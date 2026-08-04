## Backlog

- [Pending] Dark Mode: heading/paragraph text inside `.markdown-body` stays
  dark (near-black) against the now-dark `body`/chrome background once Dark
  Mode is on — screenshot shows "Arqueología de infraestructura..." nearly
  unreadable, dark text on dark background. The background flips correctly
  (app.css's `body.dark-mode` class is clearly applying), so the failure is
  specifically in content text color, not the toggle itself. Hypothesis,
  not yet verified: `applyDarkMode` (renderer.js) swaps the
  `github-markdown-light.css`/`github-markdown-dark.css` `<link>` pair via
  `.disabled` — either the light link isn't actually getting disabled, or
  link order/specificity lets its `color: #1f2328` rule keep winning over
  the dark variant's `color: #f0f6fc` specifically for text, while the
  background happens to come from the `body` class instead and isn't
  affected the same way. Needs checking against the live DOM (computed
  `color` on a heading with Dark Mode on, and each link's actual `.disabled`
  state) before assuming this is the cause — inferred from the screenshot
  only, not confirmed.
  Also visible in the same screenshot: a solid gray/blue rectangle above
  the title, in the hero image's position — unclear if this is a related
  dark-mode/image rendering issue or something unrelated (e.g. a relative
  path problem). Confirm next session and split into its own entry if it's
  a separate bug, don't fold it into the text-color fix by default.
  
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