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

export function markdownToHtml(source: string): string {
  return md.render(source);
}
