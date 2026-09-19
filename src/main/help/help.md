# md-view Help

md-view is a minimal desktop Markdown previewer.

## Opening a file
- **File → Open… (Ctrl/Cmd+O)** opens a native file picker for a `.md` file.
- You can also pass a path on the command line: `md-view path/to/file.md`.

## Live reload
Once a file is open, md-view watches it on disk. Saving the file
re-renders the preview automatically — no manual refresh needed.

## Folder sidebar
- **File → Open Folder… (Ctrl/Cmd+Shift+O)** opens a folder in a sidebar tree.
- Dropping a folder onto the window also opens it as the tree root, the same as Open Folder….
- Clicking a folder expands it; its contents load on demand.
- Clicking a file opens it in the main pane.
- The tree auto-expands to and highlights whichever file is currently open.
- The `.. (up one level)` row navigates to the parent folder.
- Drag the divider between the tree and the document to resize the sidebar.
- **View → Show File Tree** toggles the sidebar on or off.

## Preview and Code tabs
- **View → Preview** and **View → Code** switch the main pane between the rendered Markdown and a raw-source view with syntax highlighting.
- The Code view always shows frontmatter, regardless of the **Show Frontmatter** toggle, which only affects the rendered Preview.

## Copy raw source
A copy button in the document header copies the file's raw source, frontmatter included, to the clipboard regardless of which tab is active. The button shows a brief visual confirmation on click.

## Appearance
- **View → Dark Mode** toggles a dark color scheme for the preview and syntax highlighting.
- **View → Show Frontmatter** shows or hides YAML frontmatter at the top of the document.

View-menu toggles (Dark Mode, Show Frontmatter, Show File Tree) are saved to `settings.json` and restored automatically the next time md-view launches.

## Settings file
**File → Settings** opens `settings.json` (created automatically if it doesn't exist yet) in your OS's default text editor, so you can inspect or hand-edit it directly.

## Syntax highlighting
Fenced code blocks with a recognized language tag are syntax-highlighted automatically.

## Images and links
- Relative image paths in the Markdown resolve against the open file's own folder.
- Links open in your default web browser, never inside md-view itself.

## Keyboard shortcuts
| Shortcut | Action |
|---|---|
| Ctrl/Cmd+O | Open a file |
| Ctrl/Cmd+Shift+O | Open a folder |
| F1 | Open this Help window |
