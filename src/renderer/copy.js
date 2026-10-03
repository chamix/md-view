// Task 49: Copy text (functional_domain.md #196-#203, initial_scaffold.md
// Task 49 Step 1, D1-D4; ADR-013). Classic script, loaded by index.html AFTER
// diagrams.js and BEFORE renderer.js; renderer.js is the composition root
// that wires these pieces to the DOM/IPC, same posture as diagrams.js.
//
// Dependency direction (inward), same posture as diagrams.js:
//   [pure policy]  escapeHtml, preCodeHtml, diagramCopyPayload,
//                  codeCopyAllPayload, isDiagramWrapperElement,
//                  classifyCopyTarget, targetHasCopyTarget,
//                  shouldIncludeFrontmatterInCopyAll
//   [use case]     createCopyTargetMemory -- remembers the last contextmenu
//                  classification for the menu-click IPC to consume, no DOM
//   [adapters]     createRangeCopySerializer (D3: Range -> {text, html} via
//                  clone/substitute/off-screen-mount), createCopyController
//                  (wires contextmenu/copy listeners + clipboard write --
//                  renderer.js only calls into this, per D2/ADR-013)

// ---------------------------------------------------------------- policy ---

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The ONE way plain text becomes an escaped "raw block" html fragment in
// this feature -- used both for diagram substitution (D3/ADR-013's "new
// invariant": a FRESH <pre><code>, never the original wrapper's outerHTML
// with children swapped, which would leak data-mdview-source/data-diagram/
// class="md-view-diagram" -- #198's F7 fault) and for the Code tab's Copy
// All html (#197), so the two never drift into separately-maintained
// escaping.
function preCodeHtml(text) {
  return '<pre><code>' + escapeHtml(text) + '</code></pre>';
}

// #198: a right-click directly on a diagram (no live selection) copies
// exactly its Mermaid source, in both formats -- never SVG, never a drawn
// label.
function diagramCopyPayload(source) {
  return { text: source, html: preCodeHtml(source) };
}

// #197: Code tab Copy All -- text is byte-identical to copyRawSource's own
// payload (the caller passes codeContentEl.textContent verbatim, never a
// re-derived string); html reuses the same preCodeHtml wrapping diagram
// substitution uses, so there is exactly one escaping implementation in this
// whole feature.
function codeCopyAllPayload(rawText) {
  return { text: rawText, html: preCodeHtml(rawText) };
}

// Pure predicate over a duck-typed element (classList.contains) -- testable
// with a plain fake object, same style as diagrams.test.ts's fakeView/
// fakeEngine ports, no real DOM required.
function isDiagramWrapperElement(el) {
  return !!(el && el.classList && typeof el.classList.contains === 'function' && el.classList.contains('md-view-diagram'));
}

// contextmenu classification (#201): a diagram target wins over a live
// selection, which wins over nothing. The DOM-side scope check (is the
// event even inside #content/#code-content) lives in the adapter below,
// which is the only place event.target is read -- this function only
// decides among three already-computed booleans.
function classifyCopyTarget(facts) {
  if (facts.insideDiagram) return 'diagram';
  if (facts.hasSelection) return 'selection';
  return 'none';
}

// #201: Copy is enabled for 'diagram' or 'selection', disabled for 'none'.
// Copy All's enabled state depends only on documentOpen, computed by the
// caller -- not this function.
function targetHasCopyTarget(classification) {
  return classification === 'diagram' || classification === 'selection';
}

// #197/D4/F4: Copy All in Preview includes #frontmatter only when it is
// actually shown -- named/exported on its own so the adapter has exactly one
// line to call (and F4's fault injection has exactly one line to remove).
function shouldIncludeFrontmatterInCopyAll(frontmatterHidden) {
  return !frontmatterHidden;
}

// -------------------------------------------------------------- use case ---

// Remembers the last contextmenu classification so the menu-click IPC
// (which arrives asynchronously, after main pops the menu and the user
// clicks an item) can consume it without needing a live DOM query at that
// later point (D2's revised design: no selection is mutated to make this
// work). Defaults to 'none' -- a stray onCopyCommand('copy') with no prior
// contextmenu classification does nothing, rather than guessing.
function createCopyTargetMemory() {
  let remembered = { kind: 'none' };
  return {
    remember(classification, diagramSource) {
      if (classification === 'diagram') {
        remembered = { kind: 'diagram', source: diagramSource };
      } else if (classification === 'selection') {
        remembered = { kind: 'selection' };
      } else {
        remembered = { kind: 'none' };
      }
    },
    current() {
      return remembered;
    },
  };
}

// -------------------------------------------------------------- adapters ---

// D3: Range -> {text, html}. Clones the range's contents, replaces every
// .md-view-diagram node in the CLONE (never the live DOM) with a fresh
// <pre><code> built from that node's own data-mdview-source (#199: the
// dataset survives cloning, since cloneContents()/cloneNode(true) copies
// attributes), then mounts the clone in an off-screen-but-laid-out container
// (position: fixed, NOT display: none -- innerText needs layout) and reads
// container.innerHTML / .innerText (never .textContent, which collapses
// block boundaries -- F3).
function createRangeCopySerializer(doc) {
  const substituteDiagrams = (root) => {
    const wrappers = Array.from(root.querySelectorAll('.md-view-diagram'));
    wrappers.forEach((wrapper) => {
      const source = (wrapper.dataset && wrapper.dataset.mdviewSource) || '';
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = source;
      pre.appendChild(code);
      wrapper.replaceWith(pre);
    });
  };

  // A Range whose boundary points fall entirely WITHIN a single diagram
  // wrapper (e.g. a manual drag-selection made directly inside a rendered
  // diagram's SVG, rather than a selection that spans across the whole
  // wrapper) never contains a clone of the wrapper ELEMENT itself --
  // Range.cloneContents() only clones the wrapper's CHILDREN in that case
  // (the wrapper is the range's own container, not a node contained BY the
  // range), so substituteDiagrams' querySelectorAll('.md-view-diagram') would
  // find nothing to replace and silently leak the diagram's rendered SVG
  // text/labels. Detected up front via the range's commonAncestorContainer
  // and delegated to the same diagramCopyPayload() the diagram-only
  // right-click path uses -- one escaping implementation, not a second one
  // for this edge case.
  const closestDiagramWrapperFor = (node) => {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el) {
      if (isDiagramWrapperElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  };

  return {
    serialize(range) {
      const confiningWrapper = closestDiagramWrapperFor(range.commonAncestorContainer);
      if (confiningWrapper) {
        return diagramCopyPayload(confiningWrapper.dataset.mdviewSource || '');
      }

      const clone = range.cloneContents();
      substituteDiagrams(clone);

      const container = doc.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '0';
      doc.body.appendChild(container);
      container.appendChild(clone);
      const html = container.innerHTML;
      const text = container.innerText;
      doc.body.removeChild(container);
      return { text, html };
    },
  };
}

// Wires the contextmenu/copy listeners and the menu-command handler on top
// of the pure policy/use-case pieces above. Owns no state beyond the target
// memory (use case). Every DOM/clipboard boundary is a port (`doc`, `win`,
// the three element refs, `documentOpen`), same posture as diagrams.js's
// adapters taking `doc`/engine ports rather than reaching into globals.
function createCopyController({ doc, win, contentEl, codeContentEl, frontmatterEl, documentOpen }) {
  const serializer = createRangeCopySerializer(doc);
  const memory = createCopyTargetMemory();

  const isInsideDocumentArea = (node) => {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !!(el && ((contentEl && contentEl.contains(el)) || (codeContentEl && codeContentEl.contains(el))));
  };

  const closestDiagramWrapper = (node) => {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== contentEl && el !== codeContentEl) {
      if (isDiagramWrapperElement(el)) return el;
      el = el.parentElement;
    }
    return null;
  };

  // Only a selection actually anchored inside #content/#code-content counts
  // (#201's "only over the document area" reading applied to Copy too, not
  // just the context menu itself) -- a selection elsewhere in the chrome
  // (e.g. the tree panel, if the browser ever allows it) must never leak in.
  const documentSelectionRange = () => {
    const sel = win.getSelection ? win.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return isInsideDocumentArea(range.commonAncestorContainer) ? range : null;
  };

  const isCodeTabActive = () => !!codeContentEl && !codeContentEl.hidden;

  const rangeContainsDiagram = (range) => {
    if (!contentEl) return false;
    const wrappers = contentEl.querySelectorAll('.md-view-diagram');
    for (let i = 0; i < wrappers.length; i++) {
      if (range.intersectsNode(wrappers[i])) return true;
    }
    return false;
  };

  const writeClipboard = (payload) => {
    const item = new win.ClipboardItem({
      'text/plain': new win.Blob([payload.text], { type: 'text/plain' }),
      'text/html': new win.Blob([payload.html], { type: 'text/html' }),
    });
    return win.navigator.clipboard.write([item]);
  };

  const buildCopyAllRange = () => {
    const range = doc.createRange();
    const includeFrontmatter = !!frontmatterEl && shouldIncludeFrontmatterInCopyAll(frontmatterEl.hidden);
    if (includeFrontmatter) {
      range.setStartBefore(frontmatterEl);
    } else {
      range.setStartBefore(contentEl);
    }
    range.setEndAfter(contentEl);
    return range;
  };

  const buildCopyAllPayload = () => {
    if (isCodeTabActive()) {
      return codeCopyAllPayload(codeContentEl.textContent || '');
    }
    return serializer.serialize(buildCopyAllRange());
  };

  const buildRememberedCopyPayload = () => {
    const remembered = memory.current();
    if (remembered.kind === 'diagram') {
      return diagramCopyPayload(remembered.source || '');
    }
    if (remembered.kind === 'selection') {
      const range = documentSelectionRange();
      return range ? serializer.serialize(range) : null;
    }
    return null;
  };

  return {
    // Task 49: right-click inside #content/#code-content (the listener is
    // attached ONLY to those two elements -- #201's "only over the document
    // area" falls out of where this is attached, not a runtime check here).
    // Classifies the target, remembers it for onCopyCommand('copy'), and
    // returns the { hasCopyTarget, documentOpen } descriptor for main's
    // popupCopyMenu call. Never mutates window.getSelection() (D2 revised).
    onContextMenu(event) {
      event.preventDefault();
      const wrapper = closestDiagramWrapper(event.target);
      const hasSelection = !!documentSelectionRange();
      const classification = classifyCopyTarget({ insideDiagram: !!wrapper, hasSelection });
      memory.remember(classification, wrapper ? wrapper.dataset.mdviewSource || '' : undefined);
      return { hasCopyTarget: targetHasCopyTarget(classification), documentOpen: !!documentOpen() };
    },

    // Task 49/ADR-013 D2: the native `copy` ClipboardEvent, scoped to fire
    // only for a target inside #content/#code-content. No diagram in the
    // selection: return without preventDefault -- Chromium's own default
    // already writes both formats correctly (verified by probe). A diagram
    // is involved: preventDefault and build { text, html } with the same D3
    // serializer the menu-triggered paths use (#200 keyboard parity).
    onCopyEvent(event) {
      if (!isInsideDocumentArea(event.target)) return;
      const range = documentSelectionRange();
      if (!range || !rangeContainsDiagram(range)) return;
      event.preventDefault();
      const payload = serializer.serialize(range);
      event.clipboardData.setData('text/plain', payload.text);
      event.clipboardData.setData('text/html', payload.html);
    },

    // Task 49/D2: main's content-free 'copy'|'copy-all' push. Builds the
    // payload from the remembered contextmenu target (Copy) or the whole
    // visible pane (Copy All, D4), then writes with
    // navigator.clipboard.write() -- no execCommand, no webContents.copy(),
    // no selection ever moved (ADR-013).
    onCopyCommand(action) {
      if (!documentOpen()) return Promise.resolve();
      const payload = action === 'copy-all' ? buildCopyAllPayload() : buildRememberedCopyPayload();
      if (!payload) return Promise.resolve();
      return Promise.resolve(writeClipboard(payload));
    },
  };
}

// No-op in the browser; lets Vitest require() this file under plain Node,
// same guard diagrams.js/renderer.js use.
if (typeof module !== 'undefined') {
  module.exports = {
    escapeHtml,
    preCodeHtml,
    diagramCopyPayload,
    codeCopyAllPayload,
    isDiagramWrapperElement,
    classifyCopyTarget,
    targetHasCopyTarget,
    shouldIncludeFrontmatterInCopyAll,
    createCopyTargetMemory,
    createRangeCopySerializer,
    createCopyController,
  };
}
