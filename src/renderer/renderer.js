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

// Task 21: pure fetch-or-reveal caching predicate. A folder's children
// container starts empty (no child nodes) and, once fetched, always ends up
// with at least one child node -- either real entry rows, one inline error
// row (ok:false), or one "empty folder" indicator row (ok:true, zero
// entries). That last case is why this predicate is keyed off child-node
// *count*, not "does it contain real TreeEntry rows": an empty result must
// still be recorded as "already fetched," or a truly-empty directory would
// never satisfy guardrail #21 (exactly one listDirectory call per folder,
// ever) -- every re-expand of an empty folder would look indistinguishable
// from "never fetched" and re-fetch forever.
function needsFetch(childElementCount) {
  return childElementCount === 0;
}

// Task 24: separator-aware "is childPath located under parentPath"
// check -- must not mistake /foo/bar2 as being under /foo/bar.
function isPathUnder(childPath, parentPath) {
  if (childPath === parentPath) return true;
  return (
    childPath.startsWith(parentPath.replace(/[/\\]$/, '') + '/') ||
    childPath.startsWith(parentPath.replace(/[/\\]$/, '') + '\\')
  );
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

  // Task 24: tree-panel auto-expand + highlight-active-file state.
  let currentTreeRootPath = null;
  let activeFilePath = null;
  let activeRowEl = null;
  let revealToken = 0;

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

    activeFilePath = message.ok ? message.filePath : null;
    revealAndHighlight();
  });

  window.mdview.onViewSettings((settings) => {
    lastViewSettings = settings;
    applyDarkMode(settings.darkMode);
    updateFrontmatterVisibility();
    // Task 28: display:none only -- never removes/resets tree DOM state
    // (expanded folders, fetched children, active highlight all survive a
    // hide/show cycle untouched).
    document.body.classList.toggle('tree-panel-hidden', !settings.showTreePanel);
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

  // Task 21: tree sidebar. First renderer consumer of Task 17/18's
  // FOLDER_TREE_ROOT / listDirectory contract -- entries arrive already
  // filtered and sorted (functional_domain.md guardrail #20), so nothing
  // here re-filters or re-sorts, ever.
  const treePanelEl = document.getElementById('tree-panel');
  const treeEmptyStateEl = document.getElementById('tree-empty-state');
  const treeRootEl = document.getElementById('tree-root');

  // Task 23: drag-to-resize handle. #tree-panel is fixed-positioned at the
  // viewport's left edge (Task 26; was the flex row's first child pre-
  // Task-26 -- the mechanism changed, the left-edge-at-x=0 fact did not),
  // so a live pointer clientX *is* the desired panel width -- no
  // delta/offset tracking needed. See functional_domain.md Task 23 for the
  // full domain rationale.
  const treeResizeHandleEl = document.getElementById('tree-resize-handle');
  const MIN_TREE_WIDTH = 180;
  const MIN_MAIN_PANEL_WIDTH = 300;

  treeResizeHandleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing-tree-panel');

    const onMouseMove = (moveEvent) => {
      const maxTreeWidth = window.innerWidth - MIN_MAIN_PANEL_WIDTH;
      const clamped = Math.min(maxTreeWidth, Math.max(MIN_TREE_WIDTH, moveEvent.clientX));
      document.documentElement.style.setProperty('--tree-panel-width', `${clamped}px`);
    };
    const onMouseUp = () => {
      document.body.classList.remove('resizing-tree-panel');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  const TREE_EMPTY_STATE_DEFAULT_TEXT = 'No folder open.';

  const createTreeRow = (labelText, extraClassName) => {
    const row = document.createElement('div');
    row.className = extraClassName ? 'tree-row ' + extraClassName : 'tree-row';
    row.textContent = labelText;
    return row;
  };

  // One row-rendering function, called recursively for nested levels
  // (initial_scaffold.md's documented Composite-shaped-without-a-class
  // decision) -- each TreeEntry becomes one DOM node, appended into
  // `parentEl`, never replacing siblings already there.
  const renderTreeLevel = (entries, parentEl) => {
    entries.forEach((entry) => {
      const node = document.createElement('div');
      node.className = 'tree-node';
      node.dataset.path = entry.path;

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = document.createElement('span');
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = entry.name;

      if (entry.type === 'directory') {
        node.classList.add('tree-directory');
        toggle.className = 'tree-toggle';
        toggle.textContent = '▸'; // ▸, rotated via CSS when expanded
        row.appendChild(toggle);
        row.appendChild(label);
        node.appendChild(row);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'tree-children';
        childrenEl.hidden = true;
        node.appendChild(childrenEl);

        row.addEventListener('click', () => {
          handleDirectoryRowClick(entry.path, childrenEl, toggle);
        });
      } else {
        node.classList.add('tree-file');
        toggle.className = 'tree-toggle tree-toggle-spacer';
        row.appendChild(toggle);
        row.appendChild(label);
        node.appendChild(row);

        // Guardrail #22/#23: exactly one REQUEST_OPEN_FILE per click, using
        // entry.path verbatim, and nothing else -- no local DOM update. The
        // existing FILE_RENDERED -> onFileRendered pipeline above handles
        // the resulting content/status-bar update, exactly as it already
        // does for File>Open and drag-and-drop.
        row.addEventListener('click', () => {
          window.mdview.openFileByPath(entry.path);
        });
      }

      parentEl.appendChild(node);
    });
  };

  const handleDirectoryRowClick = async (folderPath, childrenEl, toggleEl) => {
    // Guardrail #21: exactly one listDirectory call per folder, ever, across
    // any number of collapse/re-expand cycles. Once populated (real entries,
    // an error row, or the empty-folder indicator row), every subsequent
    // click is a pure visibility toggle, zero fetch.
    if (!needsFetch(childrenEl.childElementCount)) {
      childrenEl.hidden = !childrenEl.hidden;
      toggleEl.classList.toggle('tree-toggle-expanded', !childrenEl.hidden);
      return;
    }

    const loadingRow = createTreeRow('Loading…', 'tree-loading');
    childrenEl.appendChild(loadingRow);
    childrenEl.hidden = false;
    toggleEl.classList.add('tree-toggle-expanded');

    const result = await window.mdview.listDirectory(folderPath);

    childrenEl.removeChild(loadingRow);

    if (result.ok) {
      if (result.entries.length === 0) {
        // Genuinely empty, not an error -- and still counts as "fetched"
        // (needsFetch's own doc comment explains why this row must exist).
        childrenEl.appendChild(createTreeRow('(empty folder)', 'tree-empty'));
      } else {
        renderTreeLevel(result.entries, childrenEl);
      }
    } else {
      // Guardrail #26: a visible inline error, never a silent no-op, never
      // an unhandled rejection -- listDirectory always resolves (Task 17
      // guardrail #3), so there is nothing here to catch/reject.
      childrenEl.appendChild(createTreeRow('Could not list folder: ' + result.error, 'tree-error'));
    }
  };

  // Task 24: walks the just-rendered tree, level by level, to reveal +
  // highlight whichever file is currently active -- reused (via the token
  // guard) as the single source of truth for both "a new tree root arrived"
  // and "a new file was opened" triggers, since either one alone can make
  // the previous highlight stale.
  const revealAndHighlight = async () => {
    revealToken += 1;
    const myToken = revealToken;

    if (activeRowEl) {
      activeRowEl.classList.remove('tree-row-active');
      activeRowEl = null;
    }

    if (!currentTreeRootPath || !activeFilePath || !isPathUnder(activeFilePath, currentTreeRootPath)) {
      return;
    }

    let containerEl = treeRootEl;
    let remainingPath = activeFilePath;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!containerEl) return;

      const candidates = Array.from(containerEl.children).filter((child) => child.classList.contains('tree-node'));
      const targetNode = candidates.find((node) => node.dataset.path === remainingPath);

      if (targetNode) {
        const row = targetNode.querySelector(':scope > .tree-row');
        if (row) {
          row.classList.add('tree-row-active');
          activeRowEl = row;
          row.scrollIntoView({ block: 'nearest' });
        }
        return;
      }

      const ancestorNode = candidates.find(
        (node) => node.dataset.path && isPathUnder(remainingPath, node.dataset.path)
      );

      if (!ancestorNode) return;

      const childrenEl = ancestorNode.querySelector(':scope > .tree-children');
      const toggleEl = ancestorNode.querySelector(':scope > .tree-row > .tree-toggle');

      if (needsFetch(childrenEl.childElementCount)) {
        await handleDirectoryRowClick(ancestorNode.dataset.path, childrenEl, toggleEl);
        if (myToken !== revealToken) return;
      } else if (childrenEl.hidden) {
        childrenEl.hidden = false;
        toggleEl.classList.add('tree-toggle-expanded');
      }

      containerEl = childrenEl;
    }
  };

  window.mdview.onFolderTreeRoot((message) => {
    // Guardrail #27: full replace, never append -- no stale nodes from a
    // previous root ever remain visible or in the DOM after a folder
    // switch.
    if (treeRootEl) treeRootEl.textContent = '';

    if (!message.ok) {
      if (treeRootEl) treeRootEl.hidden = true;
      if (treeEmptyStateEl) {
        treeEmptyStateEl.textContent = 'Could not open folder: ' + message.error;
        treeEmptyStateEl.hidden = false;
      }
      currentTreeRootPath = null;
      return;
    }

    if (treeEmptyStateEl) {
      treeEmptyStateEl.textContent = TREE_EMPTY_STATE_DEFAULT_TEXT;
      treeEmptyStateEl.hidden = true;
    }
    if (treeRootEl) {
      // Task 27: "Up one level" row -- unconditionally rendered first, every
      // time a root is successfully established, regardless of whether that
      // root happens to already be a filesystem root (a click there is a
      // harmless no-op via establishTreeRoot's own existing same-root guard
      // in the main process -- guardrail #4). Deliberately NOT `.tree-node`:
      // Task 24's revealAndHighlight walk filters specifically on that class
      // (see its own comment), so this row stays invisible to it without any
      // change there.
      const upRow = createTreeRow('.. (up one level)', 'tree-row-up');
      upRow.addEventListener('click', () => window.mdview.requestTreeParent());
      treeRootEl.appendChild(upRow);

      renderTreeLevel(message.entries, treeRootEl);
      treeRootEl.hidden = false;
    }

    currentTreeRootPath = message.rootPath;
    revealAndHighlight();
  });

  void treePanelEl; // referenced for clarity/future use; no direct manipulation needed today

  // Task 29: frameless main window's custom title bar. Each label/button
  // handler is a one-line call into window.mdview -- no menu-structure
  // knowledge and no local state mutation live in the renderer at all
  // (functional_domain.md guardrails #67/#69).
  const menuLabelFile = document.getElementById('menu-label-file');
  const menuLabelView = document.getElementById('menu-label-view');
  const menuLabelHelp = document.getElementById('menu-label-help');

  if (menuLabelFile) {
    menuLabelFile.addEventListener('click', (event) => {
      window.mdview.popupMenu('file', event.clientX, event.clientY);
    });
  }
  if (menuLabelView) {
    menuLabelView.addEventListener('click', (event) => {
      window.mdview.popupMenu('view', event.clientX, event.clientY);
    });
  }
  if (menuLabelHelp) {
    menuLabelHelp.addEventListener('click', (event) => {
      window.mdview.popupMenu('help', event.clientX, event.clientY);
    });
  }

  const windowMinimizeEl = document.getElementById('window-minimize');
  const windowMaximizeEl = document.getElementById('window-maximize');
  const windowCloseEl = document.getElementById('window-close');

  if (windowMinimizeEl) {
    windowMinimizeEl.addEventListener('click', () => window.mdview.minimizeWindow());
  }
  if (windowMaximizeEl) {
    windowMaximizeEl.addEventListener('click', () => window.mdview.toggleMaximizeWindow());
  }
  if (windowCloseEl) {
    windowCloseEl.addEventListener('click', () => window.mdview.closeWindow());
  }

  // The ONLY place the maximize/restore button's appearance changes -- main
  // is the single source of truth for the real OS-level maximized fact,
  // regardless of which path (this button, a double-click, an OS action)
  // caused the transition (functional_domain.md guardrail #69). Never
  // assumed optimistically on click above.
  window.mdview.onWindowMaximizedState((isMaximized) => {
    if (windowMaximizeEl) {
      windowMaximizeEl.classList.toggle('is-maximized', isMaximized);
      windowMaximizeEl.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
    }
  });
}

// No-op in the browser (there is no `module` global there); lets Vitest
// `require()` this file under Node without needing jsdom, a bundler, or
// converting the file to an ES module the <script> tag would need updating for.
if (typeof module !== 'undefined') {
  module.exports = {
    applyRenderedContent,
    statusBarText,
    shouldShowFrontmatter,
    firstDroppedFile,
    needsFetch,
    isPathUnder,
  };
}
