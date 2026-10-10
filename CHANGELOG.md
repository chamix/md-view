# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-10-09

### Added

- Copy text: select text in the Preview or Code view and copy it with `Ctrl/Cmd+C` or the right-click Copy menu item; Copy All copies the whole visible view — the rendered document in Preview (including frontmatter when it's shown), or the raw Markdown source in Code. A Mermaid diagram always copies its Markdown source, never its rendered drawing, whether you right-click it directly, select across it, or include it in Copy All.
- Skins: View → Skin picks the color scheme of the app chrome (title bar, tab strip, folder sidebar, status bar) and the code-highlighting colors. Four built-in skins ship — Default, Claude, Obsidian, and Tokyo Night — each with independent light and dark halves; Dark Mode decides which half shows without changing the active skin. View → Skin → Edit Skins… opens `skins.json` for hand-editing custom skins.

## [1.2.0] - 2026-09-28

### Added

- File → Close (`Ctrl/Cmd+W`) closes the open file and returns to the "No file open" view. The folder tree stays open. Close is disabled when no file is open.
- Mermaid diagrams: fenced code blocks tagged `mermaid` render as diagrams in the Preview and follow Dark Mode. An invalid or oversized diagram shows a notice and its source without affecting the rest of the document. Theme and security settings written inside a diagram are ignored. The Code tab and the copy button still show the raw Markdown.
- Help → About md-view shows the app version, the Electron, Chromium, and Node.js versions, the copyright, the license, a repository link, and the license notices of the open-source libraries bundled with md-view.

### Changed

- Live reload now waits until a save has finished before refreshing the preview.

### Fixed

- The preview could go blank after a save that empties the file before writing it, and stayed blank until the next save.
- `settings.json` is now written atomically, so it is never seen half-written.
- The Help and What's New windows were unstyled; they now use the app's styles.

### Security

- The main window now has a Content Security Policy: no inline or eval'd scripts, and no network requests other than the images a document links to. Mermaid diagrams render with a locked configuration.
- The Help, What's New, and About windows now have a Content Security Policy that blocks all scripts.
- Third-party license notices now ship with the app, under Help → About md-view.

## [1.1.0] - 2026-09-19

### Added

- File → Settings menu item, opening `settings.json` in the OS's default text editor (creating it with defaults first if it doesn't exist).

- A "What's New" window that shows the release notes the first time md-view launches after an update.

### Changed

- Dark Mode, Show Frontmatter, and Show File Tree now persist across relaunches (previously reset every session).

## [1.0.0] - 2026-09-04

### Added

- Open a Markdown file via a native file dialog or by passing a path as a CLI argument.
- Live-reload: the open file is watched and re-rendered automatically on save.
- GitHub-flavored Markdown rendering.
- Syntax highlighting for fenced code blocks with a declared language.
- Relative image paths in the Markdown source resolve correctly against the open file's directory.
- External links open in the system's default browser instead of inside the app.
- Drag and drop a Markdown file from the OS onto the window to open it.
- Dark Mode and Show Frontmatter toggles in the View menu.
- An in-app Help window with usage documentation, available via Help → md-view Help or the `F1` key.
- Open Folder… opens a folder in a sidebar tree, with lazy-expanding folders, click-to-open files, auto-expand and highlight of the currently open file, an up-one-level row, and a draggable resize divider. The sidebar can be shown or hidden from the View menu.
- Drag and drop a folder from the OS onto the window to open it as the sidebar tree root, the same as Open Folder….
- Preview and Code tabs in the main pane: Code shows the raw Markdown source, frontmatter included, with syntax highlighting.
- A copy button in the document header copies the file's raw source to the clipboard, with a brief visual confirmation on click.
- A frameless main window with a custom title bar, window controls, and popup File/View/Help menus.

### Fixed

- Dark Mode rendered plain black text instead of the dark color palette after opening a file.
- HTML comments in the Markdown source showed up as visible text in the preview instead of being hidden.
- The Help window incorrectly showed the main File/View/Help menu bar.
- The file tree occasionally reloaded itself unnecessarily on Windows due to a path-casing mismatch.
- Dropping a folder onto the window was incorrectly rejected as "not a Markdown file".
- The Code tab's raw source forced horizontal scrolling instead of wrapping.
