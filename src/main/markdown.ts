import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false }); // explicit: never allow raw HTML passthrough from source

export function markdownToHtml(source: string): string {
  return md.render(source);
}
