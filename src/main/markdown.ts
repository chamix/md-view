import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      return '';
    }
  }
  return '';
}

const md = new MarkdownIt({ html: false, highlight: highlightCode }); // explicit: never allow raw HTML passthrough from source

// Strips author-written HTML comments from rendered content. This is a core
// rule (runs after block + inline parsing, before rendering) rather than a
// renderer.rules.text override: mutating only the text token's content still
// leaves the surrounding paragraph_open/paragraph_close wrapper in the token
// stream, producing a visible empty <p></p> gap for a comment-only paragraph.
// This rule strips the comment from each inline token's text children and,
// when that leaves an inline token with no children at all (the comment was
// the paragraph's only content), removes the now-empty open/inline/close
// token triplet entirely so the paragraph produces no output.
// Known scope boundary: a comment whose <!-- / --> delimiters are split across a Markdown soft line break lands in separate `text` tokens and is NOT caught by this per-token regex.
md.core.ruler.push('strip_html_comments', (state) => {
  const tokens = state.tokens;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token.type !== 'inline' || !token.children) continue;

    for (const child of token.children) {
      if (child.type === 'text') {
        child.content = child.content.replace(/<!--[\s\S]*?-->/g, '');
      }
    }
    token.children = token.children.filter((child) => child.type !== 'text' || child.content !== '');

    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const isMatchingWrapperPair =
      prev &&
      next &&
      prev.nesting === 1 &&
      next.nesting === -1 &&
      prev.type.replace(/_open$/, '') === next.type.replace(/_close$/, '');
    if (token.children.length === 0 && isMatchingWrapperPair) {
      tokens.splice(i - 1, 3);
      // Compensate the loop counter: 3 tokens (i-1, i, i+1) were just removed,
      // so the next iteration's automatic `i--` must land on the token that
      // was at i-2 before the splice (indices below i-1 are unaffected by it).
      i -= 1;
    }
  }
  return true;
});

export function markdownToHtml(source: string): string {
  return md.render(source);
}

// Task 32: Code tab. Fully independent of markdownToHtml/highlightCode/md
// above -- this highlights the raw source text itself (as a "markdown"
// language document, for syntax coloring), never parses/transforms it into
// HTML output. Never calls, and is never called by, any function in this
// file.
export function highlightMarkdownSource(source: string): string {
  const value = hljs.getLanguage('markdown')
    ? hljs.highlight(source, { language: 'markdown' }).value
    : hljs.highlightAuto(source).value; // documented fallback if the guardrail #1 pre-check ever regresses
  return `<code class="hljs language-markdown">${value}</code>`;
}
