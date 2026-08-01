function applyRenderedContent(html, baseUrl, setBaseHref, setInnerHtml) {
  setBaseHref(baseUrl);
  setInnerHtml(html);
}

// Everything below touches real DOM/window globals, which don't exist when
// this file is `require()`d under plain Node (e.g. by
// tests/unit/renderer-order.test.ts). Guarding on `typeof document` keeps
// browser behavior byte-identical while letting applyRenderedContent above
// be imported and unit-tested with zero DOM, zero jsdom, and zero bundler.
if (typeof document !== 'undefined') {
  const container = document.getElementById('content');
  const baseElement = document.getElementById('content-base');

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
    if (message.ok) {
      renderHtml(message.html, message.baseUrl);
    } else {
      renderError(message.error);
    }
  });

  const openButton = document.getElementById('open-file-btn');
  if (openButton) {
    openButton.addEventListener('click', () => {
      window.mdview.openFileDialog();
    });
  }
}

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = { applyRenderedContent };
}
