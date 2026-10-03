// Task 45: Mermaid diagram pass (functional_domain.md #156-#168,
// initial_scaffold.md Task 45 Step 1). Classic script, loaded by index.html
// BEFORE renderer.js; renderer.js is the composition root that wires these
// pieces to the DOM and the IPC handlers.
//
// Dependency direction (inward):
//   [pure policy]   MERMAID_MAX_TEXT_SIZE, mermaidConfig, diagramThemeFor,
//                   exceedsMaxTextSize, createGenerationGate
//   [use case]      createDiagramController({ engine, view }) -- ports only,
//                   no DOM and no mermaid global
//   [adapters]      createMermaidEngine (engine port, virtual proxy over the
//                   on-demand bundle), createScriptAppender, createDiagramDomView
//                   (view port)

// ---------------------------------------------------------------- policy ---

// ONE constant, read by both Mermaid's maxTextSize and the app's own pre-check
// (#162 as amended): over this size Mermaid silently renders a substitute
// diagram instead of failing, so the app must refuse it itself (D4).
const MERMAID_MAX_TEXT_SIZE = 50000;

// #158 (as amended by D2): Mermaid 11.17.2's default `secure` list, plus the
// CVE-2026-41159 style vectors, plus theme/darkMode so no %%{init}%% directive
// or diagram frontmatter `config:` can override the app's theme.
const MERMAID_SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'themeCSS',
  'themeVariables',
  'fontFamily',
  'altFontFamily',
  'theme',
  'darkMode',
];

// Locked configuration; a fresh object on every call so no caller can mutate
// a shared instance.
function mermaidConfig(theme) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: MERMAID_MAX_TEXT_SIZE,
    theme,
    secure: MERMAID_SECURE_KEYS.slice(),
  };
}

function diagramThemeFor(isDark) {
  return isDark ? 'dark' : 'default';
}

function exceedsMaxTextSize(source) {
  return source.length > MERMAID_MAX_TEXT_SIZE;
}

// Monotonic token, same class of guard as renderer.js's revealToken and the
// Task 44 render epoch in main.
function createGenerationGate() {
  let current = 0;
  return {
    advance() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}

const DIAGRAM_LOAD_FAILED_MESSAGE = 'Could not load the diagram renderer.';

function tooLargeMessage(length) {
  return (
    'Diagram source is too large to render (' +
    length +
    ' characters; the limit is ' +
    MERMAID_MAX_TEXT_SIZE +
    ').'
  );
}

function renderFailureMessage(err) {
  const reason = err && typeof err === 'object' && 'message' in err ? err.message : err;
  return 'Could not render diagram: ' + String(reason);
}

// -------------------------------------------------------------- use case ---

// The only stateful piece. Ports:
//   engine.ready() -> Promise<void>   (memoized bundle load)
//   engine.render(id, source, theme) -> Promise<svgString>
//   view.collectSlots() -> [{ source, showSvg(svg), showFailure(message) }]
//
// Every entry point advances the generation SYNCHRONOUSLY, and every write is
// gated by an isCurrent check made after the last await (#163). Each public
// method returns the pass promise (which never rejects), or a resolved promise
// when there is nothing to render.
function createDiagramController({ engine, view }) {
  const gate = createGenerationGate();
  let slots = [];
  let isDark = false;

  const runPass = async (token, passSlots, theme) => {
    let loadError = null;
    try {
      await engine.ready();
    } catch (err) {
      loadError = err;
    }
    // After the load, whether it resolved or rejected (#163 amended): a Close,
    // a newer document or a theme change during the load means this pass
    // writes nothing.
    if (!gate.isCurrent(token)) return;

    if (loadError) {
      // #162 amended: a bundle-load failure is a per-diagram notice.
      passSlots.forEach((slot) => slot.showFailure(DIAGRAM_LOAD_FAILED_MESSAGE));
      return;
    }

    for (let i = 0; i < passSlots.length; i++) {
      const slot = passSlots[i];
      if (!gate.isCurrent(token)) return;
      if (exceedsMaxTextSize(slot.source)) {
        slot.showFailure(tooLargeMessage(slot.source.length));
        continue;
      }
      let svg;
      try {
        svg = await engine.render('mdv-diagram-' + token + '-' + i, slot.source, theme);
      } catch (err) {
        if (gate.isCurrent(token)) slot.showFailure(renderFailureMessage(err));
        continue;
      }
      if (gate.isCurrent(token)) slot.showSvg(svg);
    }
  };

  const startPass = (token) => {
    if (slots.length === 0) return Promise.resolve();
    // Final backstop: a pass never produces an unhandled rejection.
    return runPass(token, slots, diagramThemeFor(isDark)).catch(() => undefined);
  };

  return {
    // FILE_RENDERED ok, after the preview HTML is in the DOM. Sources are
    // captured NOW, before any SVG replaces the placeholder's <pre>.
    documentRendered() {
      const token = gate.advance();
      slots = view.collectSlots();
      return startPass(token);
    },
    // FILE_RENDERED error, and DOCUMENT_CLOSED.
    documentCleared() {
      gate.advance();
      slots = [];
    },
    // VIEW_SETTINGS. Only a real change re-renders (#164): the frontmatter
    // toggle, tree toggle and tab switches all arrive here with the same
    // darkMode value and must not touch the diagrams.
    darkModeChanged(nextIsDark) {
      const next = !!nextIsDark;
      if (next === isDark) return Promise.resolve();
      isDark = next;
      const token = gate.advance();
      return startPass(token);
    },
  };
}

// -------------------------------------------------------------- adapters ---

// Engine port over Mermaid's global API. Also a virtual proxy: the 3.5 MB
// bundle is loaded on the first ready()/render() only (D1), and the load is
// memoized, including a failure (every later render rejects without retrying).
// `scriptUrl` is resolved by the composition root against the renderer's
// initialBaseURI, never document.baseURI (D3: a decoy mermaid.min.js next to
// the user's document must never execute).
function createMermaidEngine({ scriptUrl, appendScript, getGlobal }) {
  let loading = null;
  let loaded = null;

  const ready = () => {
    if (!loading) {
      loading = Promise.resolve()
        .then(() => appendScript(scriptUrl))
        .then(() => {
          const mermaid = getGlobal();
          if (!mermaid || typeof mermaid.render !== 'function') {
            throw new Error('mermaid.min.js loaded but did not define the mermaid global');
          }
          loaded = mermaid;
          return mermaid;
        });
    }
    return loading;
  };

  return {
    ready,
    async render(id, source, theme) {
      // Once loaded, initialize + render run synchronously from the caller's
      // isCurrent check (no await in between), so a superseded pass can never
      // re-initialize Mermaid with an old theme after a newer pass started.
      const mermaid = loaded || (await ready());
      mermaid.initialize(mermaidConfig(theme));
      // bindFunctions is deliberately never called (#158: third layer behind
      // securityLevel 'strict' and the CSP).
      const result = await mermaid.render(id, source);
      return result.svg;
    },
  };
}

// appendScript for the engine: one classic <script> in <head>. onload/onerror
// are DOM properties, not inline attributes, so the CSP allows them.
function createScriptAppender(doc) {
  return (url) =>
    new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load ' + url));
      doc.head.appendChild(script);
    });
}

// View port over #content. Only reads/writes the .md-view-diagram wrappers
// produced by main's placeholder (src/main/markdown.ts).
function createDiagramDomView(containerEl, doc) {
  return {
    collectSlots() {
      if (!containerEl) return [];
      const wrappers = Array.from(containerEl.querySelectorAll('.md-view-diagram[data-diagram="mermaid"]'));
      return wrappers.map((wrapper) => {
        const code = wrapper.querySelector('code');
        // textContent decodes main's escaping exactly once (#157).
        const source = code ? code.textContent || '' : '';
        // Task 49 D1 (#199): piggyback on this existing capture point so the
        // exact source survives showSvg/showFailure replacing the wrapper's
        // CHILDREN -- the wrapper's own attributes are untouched by either.
        // No new export, no second map that could drift from this one.
        wrapper.dataset.mdviewSource = source;
        return {
          source,
          showSvg(svg) {
            // Second innerHTML sink in the renderer, same trust class as
            // renderer.js's container.innerHTML: Mermaid 'strict' output,
            // DOMPurify-sanitized, with the CSP (script-src 'self') as the
            // backstop. Replaces the wrapper's CHILDREN, so the wrapper survives
            // theme re-renders.
            wrapper.innerHTML = svg;
          },
          showFailure(message) {
            wrapper.textContent = '';
            const notice = doc.createElement('p');
            notice.className = 'md-view-diagram-error';
            notice.textContent = message;
            const pre = doc.createElement('pre');
            pre.className = 'md-view-diagram-source';
            const codeEl = doc.createElement('code');
            codeEl.textContent = source;
            pre.appendChild(codeEl);
            wrapper.appendChild(notice);
            wrapper.appendChild(pre);
          },
        };
      });
    },
  };
}

// No-op in the browser; lets Vitest require() this file under plain Node.
if (typeof module !== 'undefined') {
  module.exports = {
    MERMAID_MAX_TEXT_SIZE,
    mermaidConfig,
    diagramThemeFor,
    exceedsMaxTextSize,
    createGenerationGate,
    createDiagramController,
    createMermaidEngine,
    createScriptAppender,
    createDiagramDomView,
  };
}
