# md-view Help

md-view is a minimal desktop Markdown previewer.

## Opening a file
- **File → Open… (Ctrl/Cmd+O)** opens a native file picker for a `.md` file.
- You can also pass a path on the command line: `md-view path/to/file.md`.

## Closing a file
- **File → Close (Ctrl/Cmd+W)** closes the open file and returns to the "No file open" view.
- The folder sidebar stays open, so you can pick another file from the tree.
- Close is disabled when no file is open.

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

## Copying text
- Select text in the Preview or Code view and press **Ctrl/Cmd+C**, or right-click and choose **Copy**, to copy the selection to the clipboard.
- Right-click and choose **Copy All** to copy the whole visible view — the rendered document in Preview (including frontmatter when it's shown), or the raw Markdown source in Code.
- A Mermaid diagram always copies its Markdown source, never its drawing — whether you right-click directly on it, select text that spans it, or use Copy All.
- The right-click menu only appears over the document area, and Copy is disabled when there's nothing selected (unless you're right-clicking a diagram). Both items are disabled when no file is open.

## Appearance
- **View → Dark Mode** toggles a dark color scheme for the preview and syntax highlighting.
- **View → Show Frontmatter** shows or hides YAML frontmatter at the top of the document.

View-menu toggles (Dark Mode, Show Frontmatter, Show File Tree) are saved to `settings.json` and restored automatically the next time md-view launches.

## Settings file
**File → Settings** opens `settings.json` (created automatically if it doesn't exist yet) in your OS's default text editor, so you can inspect or hand-edit it directly.

## Syntax highlighting
Fenced code blocks with a recognized language tag are syntax-highlighted automatically.

## Mermaid diagrams
- A fenced code block with the language tag `mermaid` renders as a diagram in the Preview.
- Diagrams follow **View → Dark Mode**.
- If a diagram is invalid or too large to render, md-view shows a notice and the diagram's source in its place. The rest of the document renders normally.
- Theme and security settings written inside a diagram are ignored; md-view always applies its own.
- The Code tab and the copy button still show the diagram's raw Markdown.

## Images and links
- Relative image paths in the Markdown resolve against the open file's own folder.
- Links open in your default web browser, never inside md-view itself.

## About md-view
**Help → About md-view** shows the app version, the Electron, Chromium, and Node.js versions, the copyright, the license, and a link to the project repository. It also lists the license notices of the open-source libraries bundled with md-view.

## Keyboard shortcuts
| Shortcut | Action |
|---|---|
| Ctrl/Cmd+O | Open a file |
| Ctrl/Cmd+Shift+O | Open a folder |
| Ctrl/Cmd+W | Close the open file |
| F1 | Open this Help window |
