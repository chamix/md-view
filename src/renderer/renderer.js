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

// Everything below touches real DOM/window globals, which don't exist when
// this file is `require()`d under plain Node (e.g. by
// tests/unit/renderer-order.test.ts, tests/unit/statusBarText.test.ts,
// tests/unit/shouldShowFrontmatter.test.ts). Guarding on `typeof document`
// keeps browser behavior byte-identical while letting the pure functions
// above be imported and unit-tested with zero DOM, zero jsdom, and zero
// bundler.
if (typeof document !== 'undefined') {
  const container = document.getElementById('content');
  const baseElement = document.getElementById('content-base');
  const statusBarEl = document.getElementById('status-bar');
  const emptyStateEl = document.getElementById('empty-state');
  const frontmatterEl = document.getElementById('frontmatter');

  const markdownLightLink = document.getElementById('theme-markdown-light');
  const markdownDarkLink = document.getElementById('theme-markdown-dark');
  const hljsLightLink = document.getElementById('theme-hljs-light');
  const hljsDarkLink = document.getElementById('theme-hljs-dark');

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
}

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = { applyRenderedContent, statusBarText, shouldShowFrontmatter };
}
