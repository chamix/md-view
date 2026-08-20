function applyRenderedContent(html, baseUrl, setBaseHref, setInnerHtml) {
  setBaseHref(baseUrl);
  setInnerHtml(html);
}

function statusBarText(message) {
  if (!message || !message.filePath) return 'No file open';
  return message.filePath;
}

// Pure display-decision: showing frontmatter requires two independent
// conditions to both hold — the user wants to see it (viewSettings), AND the
// currently open file actually has some to show (message.frontmatter). An
// error-variant message structurally has no frontmatter to show.
function shouldShowFrontmatter(message, viewSettings) {
  if (!viewSettings || !viewSettings.showFrontmatter) return false;
  if (!message || !message.ok) return false;
  return message.frontmatter !== null && message.frontmatter !== undefined;
}

// Pure drop-target selection: this app only ever opens a single file at a
// time (functional_domain.md), so a multi-file drop must deterministically
// pick the first entry, never the last or an arbitrary one.
function firstDroppedFile(fileList) {
  if (!fileList || fileList.length === 0) return null;
  return fileList[0];
}

// Everything below touches real DOM/window globals, which don't exist when
// this file is `require()`d under plain Node (e.g. by
// tests/unit/renderer-order.test.ts, tests/unit/statusBarText.test.ts,
// tests/unit/shouldShowFrontmatter.test.ts). Guarding on `typeof document`
// keeps browser behavior byte-identical while letting the pure functions
// above be imported and unit-tested with zero DOM, zero jsdom, and zero
// bundler.
if (typeof document !== 'undefined') {
  // Captured before anything else in this block (in particular, before the
  // theme-link resolution below and before any IPC listener is registered)
  // so it always reflects the renderer's own directory, never a value a
  // later <base href> retarget (Task 4, once a file is open) could have
  // already changed. See ADR-004.
  const initialBaseURI = document.baseURI;

  const container = document.getElementById('content');
  const baseElement = document.getElementById('content-base');
  const statusBarEl = document.getElementById('status-bar');
  const emptyStateEl = document.getElementById('empty-state');
  const frontmatterEl = document.getElementById('frontmatter');

  const markdownLightLink = document.getElementById('theme-markdown-light');
  const markdownDarkLink = document.getElementById('theme-markdown-dark');
  const hljsLightLink = document.getElementById('theme-hljs-light');
  const hljsDarkLink = document.getElementById('theme-hljs-dark');

  // Resolve each theme link's authored (relative) href to an absolute URL
  // now, against the renderer's own directory, rather than leaving
  // resolution to happen implicitly whenever the browser actually fetches
  // it. Chromium defers fetching a `disabled` stylesheet until it's
  // enabled — by the time Dark Mode is toggled on an open file, <base
  // href> has already been retargeted to that file's own directory, so an
  // unresolved relative href would 404 against the wrong folder. Reading
  // `getAttribute('href')` (the authored value) rather than the live
  // `.href` property avoids double-resolving if this ever re-runs. See
  // ADR-004.
  [markdownLightLink, markdownDarkLink, hljsLightLink, hljsDarkLink].forEach((link) => {
    if (link) link.href = new URL(link.getAttribute('href'), initialBaseURI).href;
  });

  // The empty-state message is a one-way transition: hidden permanently on
  // the first FILE_RENDERED message of either variant (ok or error), and
  // never shown again for the rest of the window's lifetime.
  const hideEmptyState = () => {
    if (emptyStateEl) {
      emptyStateEl.hidden = true;
    }
  };

  const updateStatusBar = (message) => {
    if (statusBarEl) {
      // Hard contract: textContent only, never innerHTML — filePath is an
      // OS-provided string, not markdown-derived content, but this is
      // defense-in-depth regardless (functional_domain.md guardrail #4).
      statusBarEl.textContent = statusBarText(message);
    }
  };

  const renderError = (message) => {
    container.textContent = '';
    const p = document.createElement('p');
    p.className = 'md-view-error';
    p.textContent = 'Could not open file: ' + message;
    container.appendChild(p);
  };

  const renderHtml = (html, baseUrl) => {
    applyRenderedContent(
      html,
      baseUrl,
      (url) => {
        baseElement.href = url;
      },
      (markup) => {
        container.innerHTML = markup;
      }
    );
  };

  // Dark Mode must be visually whole or not at all — this one function flips
  // every visually distinct layer (chrome, markdown content, code
  // highlighting) together, atomically. No partial-toggle state is ever
  // reachable because both stylesheet pairs and the body class are set here,
  // in one call, never independently elsewhere.
  const applyDarkMode = (isDark) => {
    if (markdownLightLink) markdownLightLink.disabled = isDark;
    if (markdownDarkLink) markdownDarkLink.disabled = !isDark;
    if (hljsLightLink) hljsLightLink.disabled = isDark;
    if (hljsDarkLink) hljsDarkLink.disabled = !isDark;
    document.body.classList.toggle('dark-mode', isDark);
  };

  // onFileRendered and onViewSettings arrive independently over two separate
  // channels (functional_domain.md: view preferences are a session fact, not
  // a per-file fact) — frontmatter visibility depends on both, so the latest
  // value of each is tracked locally and visibility is recomputed whenever
  // either changes.
  let lastMessage = null;
  let lastViewSettings = null;

  const updateFrontmatterVisibility = () => {
    if (!frontmatterEl) return;
    if (shouldShowFrontmatter(lastMessage, lastViewSettings)) {
      // Hard contract, same tier as the status bar's: raw frontmatter text
      // must never be interpreted as markup — textContent only, never
      // innerHTML (functional_domain.md Task 8 guardrail #3).
      frontmatterEl.textContent = lastMessage.frontmatter;
      frontmatterEl.hidden = false;
    } else {
      frontmatterEl.hidden = true;
    }
  };

  window.mdview.onFileRendered((message) => {
    hideEmptyState();
    updateStatusBar(message);
    lastMessage = message;
    updateFrontmatterVisibility();

    if (message.ok) {
      renderHtml(message.html, message.baseUrl);
    } else {
      renderError(message.error);
    }
  });

  window.mdview.onViewSettings((settings) => {
    lastViewSettings = settings;
    applyDarkMode(settings.darkMode);
    updateFrontmatterVisibility();
  });

  // Task 16: drag-and-drop file open. Wired to `document`, not #content or
  // #document-container, so the drop target works identically whether
  // #empty-state or #document-container is currently visible.
  //
  // dragDepth counts nested dragenter/dragleave pairs. A naive
  // dragenter-adds/dragleave-removes toggle flickers, because dragleave also
  // fires when the pointer crosses from the drop target into a *child*
  // element inside it (still logically "over" the target overall). Only
  // clearing the highlight when the depth returns to exactly 0 avoids that.
  let dragDepth = 0;

  document.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    document.body.classList.add('drag-over');
  });

  document.addEventListener('dragover', (event) => {
    event.preventDefault(); // load-bearing: without this, Electron's default action
    // navigates the whole window to the dropped file's location instead of this app
    // handling the drop
  });

  document.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('drag-over');
  });

  document.addEventListener('drop', (event) => {
    event.preventDefault(); // load-bearing, same reason as dragover
    dragDepth = 0;
    document.body.classList.remove('drag-over');
    const file = firstDroppedFile(event.dataTransfer.files);
    if (file) window.mdview.openDroppedFile(file);
  });
}

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = { applyRenderedContent, statusBarText, shouldShowFrontmatter, firstDroppedFile };
}
