# md-view Help

md-view is a minimal desktop Markdown previewer.

## Opening a file
- **File → Open… (Ctrl/Cmd+O)** opens a native file picker for a `.md` file.
- You can also pass a path on the command line: `md-view path/to/file.md`.

## Live reload
Once a file is open, md-view watches it on disk. Saving the file
re-renders the preview automatically — no manual refresh needed.

## Appearance
- **View → Dark Mode** toggles a dark color scheme for the preview and syntax highlighting.
- **View → Show Frontmatter** shows or hides YAML frontmatter at the top of the document.

Neither setting is remembered between launches — md-view always starts in its default light mode with frontmatter shown.

## Syntax highlighting
Fenced code blocks with a recognized language tag are syntax-highlighted automatically.

## Images and links
- Relative image paths in the Markdown resolve against the open file's own folder.
- Links open in your default web browser, never inside md-view itself.

## Keyboard shortcuts
| Shortcut | Action |
|---|---|
| Ctrl/Cmd+O | Open a file |
| F1 | Open this Help window |

## Out of scope for this task (explicitly, do not implement)
- Versioning/release process changes (separate task).
- Dark Mode support inside the Help window.
- Persisting Help window size/position.
- Live-reloading help.md.
