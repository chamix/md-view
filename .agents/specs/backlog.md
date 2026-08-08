## Backlog

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

- [Resolved 2026-08-08] Dark Mode: heading/paragraph text inside
  `.markdown-body` stayed dark (near-black) against the now-dark
  `body`/chrome background once Dark Mode was on — screenshot showed
  "Arqueología de infraestructura..." nearly unreadable, dark text on dark
  background. The background flipped correctly (app.css's `body.dark-mode`
  class was clearly applying), so the failure was specifically in content
  text color, not the toggle itself.
  Original hypothesis (link-disabled/specificity race between the light
  and dark `.markdown-body` rules) was checked via live DOM inspection and
  was wrong — actual cause was a different mechanism entirely: Chromium
  defers fetching `disabled` stylesheets until enabled, and by toggle time
  Task 4's dynamic `<base href>` (scoped for image-path resolution) had
  already retargeted to the open file's directory, so the dark CSS
  `<link>`s 404'd against the wrong folder. Fixed in Task 9 by resolving
  all four theme-link hrefs to absolute URLs, captured before any file can
  open. See ADR-004 and `review_report_task9.md` for the full trail.

- [Pending] Gray/blue rectangle in the hero image's position, visible in
  the same original dark-mode screenshot — split out per that entry's own
  note, since Task 9 only fixed the text-color bug and never touched
  image rendering. Unconfirmed whether this is dark-mode-related, a
  relative-path issue, or something else. Needs its own live-DOM check
  next session, same discipline as Task 9 — don't assume the cause.

- [Pending] `tests/e2e/view-menu.spec.ts` test (c)'s href-anchoring
  assertion (`expect(href).not.toContain('tests/e2e/fixtures')`, added in
  Task 9) is a negative check tied to an incidental fixture-path string,
  not a positive check against the real invariant (href must resolve
  under the app's own `dist/renderer` directory). Catches today's bug;
  wouldn't catch a future regression that resolved hrefs to some other
  wrong location not containing that substring. Low priority — worth
  swapping for a `startsWith` check against the real absolute
  `dist/renderer` path next time this test is touched.