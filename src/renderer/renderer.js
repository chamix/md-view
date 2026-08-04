function applyRenderedContent(html, baseUrl, setBaseHref, setInnerHtml) {
  setBaseHref(baseUrl);
  setInnerHtml(html);
}

function statusBarText(message) {
  if (!message || !message.filePath) return 'No file open';
  return message.filePath;
}

// Everything below touches real DOM/window globals, which don't exist when
// this file is `require()`d under plain Node (e.g. by
// tests/unit/renderer-order.test.ts, tests/unit/statusBarText.test.ts).
// Guarding on `typeof document` keeps browser behavior byte-identical while
// letting the pure functions above be imported and unit-tested with zero
// DOM, zero jsdom, and zero bundler.
if (typeof document !== 'undefined') {
  const container = document.getElementById('content');
  const baseElement = document.getElementById('content-base');
  const statusBarEl = document.getElementById('status-bar');
  const emptyStateEl = document.getElementById('empty-state');

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

  window.mdview.onFileRendered((message) => {
    hideEmptyState();
    updateStatusBar(message);

    if (message.ok) {
      renderHtml(message.html, message.baseUrl);
    } else {
      renderError(message.error);
    }
  });
}

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = { applyRenderedContent, statusBarText };
}
