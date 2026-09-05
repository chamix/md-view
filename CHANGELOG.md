# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- An application icon, including a dedicated Windows `.ico` for packaged builds.

### Fixed

- Dark Mode rendered plain black text instead of the dark color palette after opening a file.
- HTML comments in the Markdown source showed up as visible text in the preview instead of being hidden.
- The Help window incorrectly showed the main File/View/Help menu bar.
- The file tree occasionally reloaded itself unnecessarily on Windows due to a path-casing mismatch.
- Dropping a folder onto the window was incorrectly rejected as "not a Markdown file".
- The Code tab's raw source forced horizontal scrolling instead of wrapping.
